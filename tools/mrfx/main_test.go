package main

import (
	"testing"

	json "github.com/goccy/go-json"
)

func TestCodeKey(t *testing.T) {
	cases := map[[2]string]string{
		{"CPT", "99213"}:     "CPT|99213",
		{"HCPCS", "g0121"}:   "CPT|G0121",
		{"MS-DRG", "470"}:    "MS-DRG|470",
		{"DRG", "65"}:        "MS-DRG|065",
		{"MS-DRG", "MS470"}:  "MS-DRG|470",
		{"RC", "0450"}:       "RC|0450",
	}
	for in, want := range cases {
		if got := codeKey(in[0], in[1]); got != want {
			t.Errorf("codeKey(%q,%q) = %q, want %q", in[0], in[1], got, want)
		}
	}
}

func TestGroupNE(t *testing.T) {
	neNPI["1234567893"] = true
	neTIN["041234567"] = true
	g := group(providerGroup{NPI: []json.Number{"1234567893", "0"}, TIN: tinT{Type: "ein", Value: "99-9999999"}})
	if !g.ne || len(g.npis) != 1 {
		t.Fatalf("NPI match: %+v", g)
	}
	g2 := group(providerGroup{TIN: tinT{Type: "ein", Value: "04-1234567"}})
	if !g2.ne {
		t.Fatal("TIN match failed")
	}
	g3 := group(providerGroup{NPI: []json.Number{"1111111111"}, TIN: tinT{Type: "ein", Value: "123456789"}})
	if g3.ne {
		t.Fatal("out-of-region group kept")
	}
}
