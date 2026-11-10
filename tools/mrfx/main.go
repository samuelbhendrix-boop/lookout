// mrfx streams one Transparency in Coverage in-network rate file and keeps the rows that matter for New England:
// provider groups with a New England NPI (from NPPES) or a known New England tax ID, for the services in codes.csv.
// It never holds the file: download → gunzip → JSON tokens → filter → gzip CSV.
//
//	mrfx -url <file> -carrier uhc -network "Choice Plus" -npis ne-npis.txt -tins ne-tins.txt -codes codes.csv -out out/uhc-1
//
// Writes <out>.rates.csv.gz and <out>.groups.csv.gz, and prints a one-line JSON summary.
package main

import (
	"archive/zip"
	"bufio"
	"compress/gzip"
	"crypto/sha1"
	"encoding/csv"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	json "github.com/goccy/go-json"
)

const userAgent = "Mozilla/5.0 (compatible; PayersightBot; +https://github.com/samuelbhendrix-boop/lookout)"

type tinT struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}
type providerGroup struct {
	NPI []json.Number `json:"npi"`
	TIN tinT          `json:"tin"`
}
type providerRef struct {
	ID             json.Number     `json:"provider_group_id"`
	ProviderGroups []providerGroup `json:"provider_groups"`
	Location       string          `json:"location"`
}
type price struct {
	NegotiatedType string   `json:"negotiated_type"`
	Rate           float64  `json:"negotiated_rate"`
	Expiration     string   `json:"expiration_date"`
	ServiceCode    []string `json:"service_code"`
	BillingClass   string   `json:"billing_class"`
	Modifier       []string `json:"billing_code_modifier"`
}
type rateGroup struct {
	ProviderRefs   []json.Number   `json:"provider_references"`
	ProviderGroups []providerGroup `json:"provider_groups"`
	Prices         []price         `json:"negotiated_prices"`
}
type item struct {
	Arrangement string      `json:"negotiation_arrangement"`
	CodeType    string      `json:"billing_code_type"`
	Code        string      `json:"billing_code"`
	Rates       []rateGroup `json:"negotiated_rates"`
}

type groupInfo struct {
	key, tinType, tin string
	npis              []string
	ne                bool
}

var (
	neNPI   = map[string]bool{}
	neTIN   = map[string]bool{}
	codes   = map[string]bool{}
	groups  = map[string]*groupInfo{} // by group key
	refs    = map[string][]string{}   // provider_group_id → NE group keys
	written = map[string]bool{}
	stats   = map[string]int64{}
)

func digits(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// codeKey folds code types the way carriers spell them: CPT/HCPCS together; DRG codes zero-padded.
func codeKey(t, c string) string {
	t = strings.ToUpper(strings.TrimSpace(t))
	c = strings.ToUpper(strings.TrimSpace(c))
	switch {
	case t == "CPT" || t == "HCPCS":
		return "CPT|" + c
	case strings.Contains(t, "DRG"):
		if d := digits(c); d != "" {
			n, _ := strconv.Atoi(d)
			return "MS-DRG|" + fmt.Sprintf("%03d", n)
		}
	}
	return t + "|" + c
}

func loadSet(path string, into map[string]bool, norm func(string) string) {
	if path == "" {
		return
	}
	f, err := os.Open(path)
	if err != nil {
		panic(err)
	}
	defer f.Close()
	s := bufio.NewScanner(f)
	s.Buffer(make([]byte, 1<<20), 1<<20)
	for s.Scan() {
		if v := norm(strings.TrimSpace(s.Text())); v != "" {
			into[v] = true
		}
	}
}

func loadCodes(path string) {
	f, err := os.Open(path)
	if err != nil {
		panic(err)
	}
	defer f.Close()
	r := csv.NewReader(f)
	rows, err := r.ReadAll()
	if err != nil {
		panic(err)
	}
	for _, row := range rows[1:] {
		codes[codeKey(row[0], row[1])] = true
	}
}

// group registers a provider group and returns its key and whether it is in New England.
func group(pg providerGroup) *groupInfo {
	tin := digits(pg.TIN.Value)
	npis := make([]string, 0, len(pg.NPI))
	ne := neTIN[tin]
	for _, n := range pg.NPI {
		s := digits(string(n))
		if s == "" || s == "0" {
			continue
		}
		npis = append(npis, s)
		if neNPI[s] {
			ne = true
		}
	}
	sort.Strings(npis)
	h := sha1.Sum([]byte(pg.TIN.Type + ":" + tin + ":" + strings.Join(npis, ",")))
	key := hex.EncodeToString(h[:8])
	if g, ok := groups[key]; ok {
		return g
	}
	g := &groupInfo{key: key, tinType: pg.TIN.Type, tin: tin, npis: npis, ne: ne}
	groups[key] = g
	return g
}

func open(url string) (io.ReadCloser, error) {
	var body io.ReadCloser
	if strings.HasPrefix(url, "http") {
		req, _ := http.NewRequest("GET", url, nil)
		req.Header.Set("User-Agent", userAgent)
		client := &http.Client{Timeout: 0}
		res, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		if res.StatusCode != 200 {
			res.Body.Close()
			return nil, fmt.Errorf("HTTP %d", res.StatusCode)
		}
		body = res.Body
	} else {
		f, err := os.Open(url)
		if err != nil {
			return nil, err
		}
		body = f
	}
	br := bufio.NewReaderSize(body, 1<<20)
	magic, _ := br.Peek(2)
	// Zip archives (Tufts) need random access: spool to a temp file, then stream the first JSON entry.
	if len(magic) == 2 && magic[0] == 'P' && magic[1] == 'K' {
		tmp, err := os.CreateTemp("", "mrfx-*.zip")
		if err != nil {
			return nil, err
		}
		n, err := io.Copy(tmp, br)
		body.Close()
		if err != nil {
			return nil, err
		}
		zr, err := zip.NewReader(tmp, n)
		if err != nil {
			return nil, err
		}
		for _, f := range zr.File {
			if strings.HasSuffix(strings.ToLower(f.Name), ".json") || strings.HasSuffix(strings.ToLower(f.Name), ".json.gz") {
				rc, err := f.Open()
				if err != nil {
					return nil, err
				}
				name := tmp.Name()
				inner := bufio.NewReaderSize(rc, 1<<20)
				var r io.Reader = inner
				if m, _ := inner.Peek(2); len(m) == 2 && m[0] == 0x1f && m[1] == 0x8b {
					gz, err := gzip.NewReader(inner)
					if err != nil {
						return nil, err
					}
					r = gz
				}
				return struct {
					io.Reader
					io.Closer
				}{r, closerFunc(func() error { rc.Close(); tmp.Close(); return os.Remove(name) })}, nil
			}
		}
		tmp.Close()
		os.Remove(tmp.Name())
		return nil, errors.New("zip has no .json entry")
	}
	if len(magic) == 2 && magic[0] == 0x1f && magic[1] == 0x8b {
		gz, err := gzip.NewReader(br)
		if err != nil {
			return nil, err
		}
		return struct {
			io.Reader
			io.Closer
		}{gz, body}, nil
	}
	return struct {
		io.Reader
		io.Closer
	}{br, body}, nil
}

// remoteRefs fetches provider references published in a separate file ("location").
func remoteRefs(url string) []providerGroup {
	rc, err := open(url)
	if err != nil {
		stats["remote_ref_errors"]++
		return nil
	}
	defer rc.Close()
	var v struct {
		ProviderGroups []providerGroup `json:"provider_groups"`
	}
	if json.NewDecoder(rc).Decode(&v) != nil {
		stats["remote_ref_errors"]++
	}
	return v.ProviderGroups
}

type pending struct {
	it  item
	rg  int
	ids []string
}

func main() {
	url := flag.String("url", "", "rate file URL or path")
	carrier := flag.String("carrier", "", "carrier id")
	network := flag.String("network", "", "network / product label")
	npiPath := flag.String("npis", "", "New England NPIs, one per line")
	tinPath := flag.String("tins", "", "New England TINs, one per line")
	codePath := flag.String("codes", "", "codes.csv")
	out := flag.String("out", "out", "output prefix")
	flag.Parse()
	start := time.Now()
	loadSet(*npiPath, neNPI, digits)
	loadSet(*tinPath, neTIN, digits)
	loadCodes(*codePath)

	rc, err := open(*url)
	if err != nil {
		fail(err)
	}
	defer rc.Close()
	counted := &countingReader{r: rc}

	rf, _ := os.Create(*out + ".rates.csv.gz")
	rgz := gzip.NewWriter(rf)
	rw := csv.NewWriter(rgz)
	rw.Write([]string{"carrier", "network", "group_key", "code_type", "code", "modifier", "billing_class", "service_codes", "negotiated_type", "rate", "arrangement", "expiration"})
	srcID := fmt.Sprintf("%x", sha1.Sum([]byte(*url)))[:10]
	_ = srcID

	emit := func(it item, rg rateGroup, keys []string) {
		ck := codeKey(it.CodeType, it.Code)
		parts := strings.SplitN(ck, "|", 2)
		for _, k := range keys {
			for _, p := range rg.Prices {
				rw.Write([]string{*carrier, *network, k, parts[0], parts[1], strings.Join(p.Modifier, " "), p.BillingClass, strings.Join(p.ServiceCode, " "),
					p.NegotiatedType, strconv.FormatFloat(p.Rate, 'f', -1, 64), it.Arrangement, p.Expiration})
				stats["rows"]++
			}
			written[k] = true
		}
	}
	resolve := func(rg rateGroup) []string {
		var keys []string
		for _, id := range rg.ProviderRefs {
			keys = append(keys, refs[string(id)]...)
		}
		for _, pg := range rg.ProviderGroups {
			if g := group(pg); g.ne {
				keys = append(keys, g.key)
			}
		}
		return keys
	}

	dec := json.NewDecoder(counted)
	var later []pending // in_network rows seen before provider_references (rare file order)
	refsSeen := false
	if t, err := dec.Token(); err != nil || t != json.Delim('{') {
		fail(errors.New("not a JSON object"))
	}
	for dec.More() {
		kt, err := dec.Token()
		if err != nil {
			fail(err)
		}
		key, _ := kt.(string)
		switch key {
		case "provider_references":
			refsSeen = true
			dec.Token() // [
			for dec.More() {
				var pr providerRef
				if err := dec.Decode(&pr); err != nil {
					fail(fmt.Errorf("provider_references: %w", err))
				}
				pgs := pr.ProviderGroups
				if pr.Location != "" && len(pgs) == 0 {
					pgs = remoteRefs(pr.Location)
				}
				for _, pg := range pgs {
					if g := group(pg); g.ne {
						refs[string(pr.ID)] = append(refs[string(pr.ID)], g.key)
					}
				}
				stats["provider_refs"]++
			}
			dec.Token() // ]
		case "in_network":
			dec.Token()
			for dec.More() {
				var it item
				if err := dec.Decode(&it); err != nil {
					fail(fmt.Errorf("in_network: %w", err))
				}
				stats["items"]++
				if !codes[codeKey(it.CodeType, it.Code)] {
					continue
				}
				stats["items_kept"]++
				for i, rg := range it.Rates {
					if !refsSeen && len(rg.ProviderRefs) > 0 {
						ids := make([]string, len(rg.ProviderRefs))
						for j, x := range rg.ProviderRefs {
							ids[j] = string(x)
						}
						later = append(later, pending{it: item{Arrangement: it.Arrangement, CodeType: it.CodeType, Code: it.Code, Rates: []rateGroup{rg}}, rg: i, ids: ids})
						continue
					}
					if keys := resolve(rg); len(keys) > 0 {
						emit(it, rg, keys)
					}
				}
			}
			dec.Token()
		default:
			var skip json.RawMessage
			if err := dec.Decode(&skip); err != nil {
				fail(fmt.Errorf("%s: %w", key, err))
			}
		}
	}
	for _, p := range later {
		if keys := resolve(p.it.Rates[0]); len(keys) > 0 {
			emit(p.it, p.it.Rates[0], keys)
		}
	}
	rw.Flush()
	rgz.Close()
	rf.Close()

	gf, _ := os.Create(*out + ".groups.csv.gz")
	ggz := gzip.NewWriter(gf)
	gw := csv.NewWriter(ggz)
	gw.Write([]string{"carrier", "group_key", "tin_type", "tin", "npis", "ne_npis"})
	for k := range written {
		g := groups[k]
		var ne []string
		for _, n := range g.npis {
			if neNPI[n] {
				ne = append(ne, n)
			}
		}
		npis := g.npis
		if len(npis) > 2000 {
			npis = npis[:2000]
		}
		gw.Write([]string{*carrier, g.key, g.tinType, g.tin, strings.Join(npis, " "), strings.Join(ne, " ")})
	}
	gw.Flush()
	ggz.Close()
	gf.Close()

	stats["groups"] = int64(len(written))
	stats["bytes"] = counted.n
	stats["seconds"] = int64(time.Since(start).Seconds())
	b, _ := json.Marshal(map[string]any{"ok": true, "carrier": *carrier, "network": *network, "url": *url, "stats": stats})
	fmt.Println(string(b))
}

type closerFunc func() error

func (f closerFunc) Close() error { return f() }

type countingReader struct {
	r io.Reader
	n int64
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n += int64(n)
	return n, err
}

func fail(err error) {
	b, _ := json.Marshal(map[string]any{"ok": false, "error": err.Error(), "stats": stats})
	fmt.Println(string(b))
	os.Exit(1)
}
