#!/usr/bin/env python3
"""What the frontend calls and listens to: extract_contract.py <frontend-dir> [contract.json to merge]

Prints the contract as JSON: commands (invoke/fire in bridge.js), service methods (svc('name', 'method')) and events
(on('…') / api.on('…')), sorted. With an existing contract.json, the hand-set class/phase/stub of items still there are
kept and only new items get the defaults (class "mac", phase 9, stub null).
"""
import glob, json, os, re, sys


def names(front):
    br = open(os.path.join(front, 'bridge.js')).read()
    cmds = set(re.findall(r"(?:invoke|fire)\('([a-z_0-9]+)'", br))
    meths, evs = set(), set()
    for f in glob.glob(os.path.join(front, '*.js')) + glob.glob(os.path.join(front, 'modules', '*.js')):
        s = open(f).read()
        meths |= {f'{a}.{b}' for a, b in re.findall(r"svc\(\s*'([a-z0-9_]+)'\s*,\s*'([a-zA-Z0-9_]+)'", s)}
        evs |= set(re.findall(r"(?:api\.on|\bon|N\.api\.on)\(\s*'([a-zA-Z0-9:_.\-]+)'", s))
    return [('command', n) for n in sorted(cmds)] + [('method', n) for n in sorted(meths)] + [('event', n) for n in sorted(evs)]


def main():
    front = sys.argv[1]
    old = {}
    if len(sys.argv) > 2 and os.path.exists(sys.argv[2]):
        old = {(i['kind'], i['name']): i for i in json.load(open(sys.argv[2]))}
    out = [old.get((k, n), {'kind': k, 'name': n, 'class': 'mac', 'phase': 9, 'stub': None}) for k, n in names(front)]
    json.dump(out, sys.stdout, indent=1, ensure_ascii=False)
    print()


if __name__ == '__main__':
    main()
