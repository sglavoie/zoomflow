// Copied into the vendored Goldmark extension package by build.py. This runs on
// the host, where compiling the original deep regex is safe, before WASM build.
package extension

import (
    "math/rand"
    "reflect"
    "regexp"
    "regexp/syntax"
    "strings"
    "testing"
)

func TestZoomflowLinkifyCompatibility(t *testing.T) {
    atom := `[-a-zA-Z0-9@:%._\+~#=]`
    factored := `(?:` + atom + `{16}){0,15}` + atom + `{1,16}`
    for _, patched := range []*regexp.Regexp{wwwURLRegxp, urlRegexp} {
        if !strings.Contains(patched.String(), factored) {
            t.Fatal("the WebKit compatibility patch was not applied")
        }
        original := regexp.MustCompile(strings.Replace(patched.String(), factored, atom+`{1,256}`, 1))
        tree, err := syntax.Parse(patched.String(), syntax.Perl)
        if err != nil { t.Fatal(err) }
        var depth func(*syntax.Regexp) int
        depth = func(re *syntax.Regexp) int {
            max := 0
            for _, sub := range re.Sub { if d := depth(sub); d > max { max = d } }
            return max + 1
        }
        if d := depth(tree.Simplify()); d > 32 { t.Fatalf("regex nesting is still too deep: %d", d) }
        check := func(url string) {
            if a, b := original.FindStringIndex(url), patched.FindStringIndex(url); !reflect.DeepEqual(a, b) {
                t.Fatalf("match drift for %q: original=%v patched=%v", url, a, b)
            }
        }
        for length := 0; length <= 300; length++ {
            for _, prefix := range []string{"www.", "http://", "https://", "ftp://", "invalid://"} {
                for _, suffix := range []string{".com", ".co.uk/path?q=1#anchor", ".com:8080/path", ".com. trailing", ".com<script>", ".com/"} {
                    check(prefix + strings.Repeat("a", length) + suffix)
                    check(prefix + strings.Repeat("a.", length) + suffix)
                }
            }
        }
        // Dots are legal in the repeated class, so compare complete match spans
        // across suffixes and backtracking boundaries as well as accepted lengths.
        rng := rand.New(rand.NewSource(20261018))
        chars := []byte("abc.xyz012-_%@:?/#=<> ")
        for i := 0; i < 5000; i++ {
            host := make([]byte, rng.Intn(310))
            for j := range host { host[j] = chars[rng.Intn(len(chars))] }
            check("https://" + string(host) + ".example.com/path")
            check("www." + string(host) + ".com trailing")
        }
    }
}
