"""Compare recovered 2016 line declarations with independently parsed V5 text.

The text reader accepts only literal calls to g_pLineMap and constructs data.
It is not a Lua interpreter. This comparison establishes static declaration
agreement, not 2016 native behavior or golden combat trajectory agreement.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re

from scene_build import Catalog, simplify
from scene_kl import recover


TOKEN = re.compile(r'\s+|--[^\r\n]*|"(?:[^"\\]|\\.)*"|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?|[A-Za-z_][A-Za-z_0-9]*(?:\.[A-Za-z_][A-Za-z_0-9]*)*|[(){},=:]')
METHODS = {'SetLandHeight', 'SetTeamStartPos', 'AddStartPos', 'AddLine_LUA', 'AddCameraData_LUA'}


class LiteralText:
    def __init__(self, text):
        self.tokens = []
        pos = 0
        while pos < len(text):
            match = TOKEN.match(text, pos)
            if match is None:
                raise ValueError('Unsupported text syntax at ' + str(pos))
            token = match.group()
            if not token.isspace() and not token.startswith('--'):
                self.tokens.append(token)
            pos = match.end()
        self.pos = 0

    def take(self):
        if self.pos >= len(self.tokens):
            raise ValueError('Truncated literal declaration')
        out = self.tokens[self.pos]
        self.pos += 1
        return out

    def expect(self, token):
        actual = self.take()
        if actual != token:
            raise ValueError(f'Expected {token}, got {actual}')

    def peek(self):
        return self.tokens[self.pos] if self.pos < len(self.tokens) else None

    def arguments(self):
        args = []
        self.expect('(')
        if self.peek() == ')':
            self.take()
            return args
        while True:
            args.append(self.value())
            token = self.take()
            if token == ')':
                return args
            if token != ',':
                raise ValueError('Expected argument separator')

    def value(self):
        token = self.take()
        if token == '{':
            table = {}
            while self.peek() != '}':
                key = self.take()
                if not re.fullmatch('[A-Za-z_][A-Za-z_0-9]*', key) or key in table:
                    raise ValueError('Invalid or duplicate literal key')
                self.expect('=')
                table[key] = self.value()
                if self.peek() != '}':
                    self.expect(',')
            self.expect('}')
            return table
        if token.startswith('"'):
            return json.loads(token)
        if token == 'true':
            return True
        if token == 'false':
            return False
        if re.fullmatch(r'[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?', token):
            return float(token) if any(c in token for c in '.eE') else int(token)
        if token == 'D3DXVECTOR3':
            args = self.arguments()
            if len(args) != 3 or any(type(x) not in (int, float) for x in args):
                raise ValueError('Invalid literal vector')
            return args
        if re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*(?:\.[A-Za-z_][A-Za-z_0-9]*)*', token):
            if self.peek() == '(':
                raise ValueError('Unsupported call expression')
            return {'symbol': token, 'resolved': False}
        raise ValueError('Unsupported literal expression')

    def calls(self):
        out = []
        while self.peek() is not None:
            self.expect('g_pLineMap')
            self.expect(':')
            method = self.take()
            if method not in METHODS:
                raise ValueError('Unsupported line-map method: ' + method)
            out.append({'callee': method, 'arguments': self.arguments()})
        return out


def compare(reference_file, original_file):
    reference = LiteralText(reference_file.read_text(encoding='utf-8-sig')).calls()
    original = [{'callee': c['callee'], 'arguments': simplify(c['arguments'])}
                for c in recover(original_file.read_bytes())['calls'] if c['callee'] != 'D3DXVECTOR3']
    first = next((i for i, (a, b) in enumerate(zip(reference, original)) if a != b), None)
    if first is None and len(reference) != len(original):
        first = min(len(reference), len(original))
    return {'referenceCallCount': len(reference), 'originalCallCount': len(original),
            'equal': first is None, 'firstDifferenceIndex': first,
            'referenceSha256': hashlib.sha256(reference_file.read_bytes()).hexdigest(),
            'originalSha256': hashlib.sha256(original_file.read_bytes()).hexdigest(),
            'evidence': 'independent V5 literal text versus recovered original 2016 declarations; no native execution',
            'targetClientMeasured': False}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--source-root', type=Path, default=Path('asset_sources/upstream'))
    ap.add_argument('--reference', type=Path, default=Path('.cache/scene-native/Sander_Garpai_Rock_Pvpmap_Linemap.lua'))
    args = ap.parse_args()
    original = Catalog(args.source_root).lookup('Sander_Garpai_Rock_Pvpmap_Linemap.lua')
    result = compare(args.reference, original)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if not result['equal']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
