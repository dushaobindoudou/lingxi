"""Flag lines where a '#' comment is followed by what looks like code - a comment inserted mid-line swallows the statements after it
(it happened three times in build_lingxi_v5.py: a dict entry, a whole layer state, a node link). python3 check_swallowed_code.py FILE"""
import re, sys, io, tokenize
src = open(sys.argv[1]).read()
bad = []
for tok in tokenize.generate_tokens(io.StringIO(src).readline):
    if tok.type == tokenize.COMMENT:
        c = tok.string
        if re.search(r";\s*[A-Za-z_][\w.\[\]']*\s*(\(|=[^=])", c) or re.search(r"\}\s*,\s*'[^']+'\s*:", c) or re.search(r"\)\s*,\s*'[^']+'\s*:", c):
            bad.append((tok.start[0], c[:140]))
for ln, c in bad: print(f'{ln}: {c}')
print('suspicious comments:', len(bad))
