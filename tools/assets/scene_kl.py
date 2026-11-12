"""Finite KL82 scene declaration recovery. Never executes Lua or native calls.

KL container structure follows the upstream extractor's klua.py. The finite
opcode map is from the recorded V5 KlTranslate.cs reference, not opcode_map.txt.
Only literal/table/global/call declarations are accepted. Branches, loops,
closures and any unhandled opcode fail closed.
"""
from __future__ import annotations

import copy
import math
import struct


OP_NAMES = {0x0C: 'MOV', 0x14: 'KSTR', 0x16: 'KSHORT', 0x17: 'KNUM',
            0x18: 'KPRI', 0x19: 'KNIL', 0x2B: 'CALLM', 0x2C: 'CALL',
            0x3A: 'TNEW', 0x3B: 'TDUP', 0x3C: 'GGET', 0x3D: 'GSET',
            0x3E: 'TGETV', 0x3F: 'TGETS', 0x40: 'TGETB',
            0x41: 'TSETV', 0x42: 'TSETS', 0x43: 'TSETB', 0x47: 'RET0'}


class DeclarationError(ValueError):
    pass


class Reader:
    def __init__(self, data):
        self.data, self.pos = data, 0

    def take(self, count):
        if count < 0 or count > len(self.data) - self.pos:
            raise DeclarationError('Truncated KL container')
        out = self.data[self.pos:self.pos + count]
        self.pos += count
        return out

    def uleb(self):
        value = 0
        for i in range(5):
            b = self.take(1)[0]
            value |= (b & 127) << (7 * i)
            if b < 128:
                # Number constants use a 33-bit tagged low word.
                if value > 0x1ffffffff:
                    raise DeclarationError('Tagged ULEB overflow')
                return value
        raise DeclarationError('Invalid ULEB32')

    def number(self, low=None):
        out = struct.unpack('<d', struct.pack('<II', self.uleb() if low is None else low, self.uleb()))[0]
        if not math.isfinite(out):
            raise DeclarationError('Non-finite constant')
        return out

    def text(self, count):
        b = self.take(count)
        for encoding in ('utf-8', 'cp949', 'cp1252'):
            try:
                return b.decode(encoding)
            except UnicodeError:
                pass
        return b.decode('utf-8', errors='backslashreplace')

    def table_value(self):
        tag = self.uleb()
        if tag >= 5:
            return self.text(tag - 5)
        if tag == 3:
            n = self.uleb()
            return n if n < 0x80000000 else n - 0x100000000
        if tag == 4:
            return self.number()
        if tag <= 2:
            return (None, False, True)[tag]
        raise DeclarationError('Invalid table constant')

    def table(self):
        na, nh = self.uleb(), self.uleb()
        if na + nh > len(self.data):
            raise DeclarationError('Invalid table size')
        out = {i: self.table_value() for i in range(na)}
        for _ in range(nh):
            key, value = self.table_value(), self.table_value()
            if key is None or isinstance(key, (dict, list)):
                raise DeclarationError('Invalid table key')
            out[key] = value
        return out


def parse(data):
    r = Reader(data)
    if r.take(4) != b'\x1bKL\x82':
        raise DeclarationError('Expected KL82')
    flags = r.uleb()
    if flags & ~7 or flags & 1:
        raise DeclarationError('Unknown or big-endian KL flags')
    name = None if flags & 2 else r.text(r.uleb())
    protos = []
    while True:
        length = r.uleb()
        if length == 0:
            break
        p = Reader(r.take(length))
        pf, params, frames, nup = p.take(4)
        ngc, nn, ni = p.uleb(), p.uleb(), p.uleb()
        debugsize = 0
        if not flags & 2:
            debugsize = p.uleb()
            if debugsize:
                p.uleb(); p.uleb()
        code = list(struct.unpack(f'<{ni}I', p.take(ni * 4)))
        p.take(nup * 2)
        gc = []
        for _ in range(ngc):
            tag = p.uleb()
            if tag >= 5:
                gc.append(p.text(tag - 5))
            elif tag == 1:
                gc.append(p.table())
            else:
                raise DeclarationError('Only scene literal GC constants supported')
        numbers = []
        for _ in range(nn):
            n = p.uleb()
            if n & 1:
                numbers.append(p.number(n >> 1))
            else:
                n >>= 1
                numbers.append(n if n < 0x80000000 else n - 0x100000000)
        p.take(debugsize)
        if p.pos != len(p.data):
            raise DeclarationError('Extra prototype bytes')
        protos.append({'flags': pf, 'params': params, 'frames': frames,
                       'upvalues': nup, 'code': code, 'gc': list(reversed(gc)),
                       'numbers': numbers})
    if len(protos) != 1 or r.pos != len(data):
        raise DeclarationError('Scene must contain exactly one prototype')
    return {'name': name, 'flags': flags, 'prototype': protos[0]}


def symbol(name):
    return {'$symbol': name}


def display(value):
    if isinstance(value, dict):
        if '$symbol' in value:
            return value['$symbol']
        if '$result' in value:
            return 'call:' + str(value['$result'])
        if '$field' in value:
            return display(value['target']) + '.' + str(value['$field'])
    return repr(value)


def plain_table(value):
    return isinstance(value, dict) and not any(isinstance(k, str) and k.startswith('$') for k in value)


def reduce_parsed(parsed):
    fn = parsed['prototype']
    if fn['upvalues'] or fn['params']:
        raise DeclarationError('Non-static scene prototype')
    code = fn['code']
    unsupported = sorted(set(w & 255 for w in code) - OP_NAMES.keys())
    if unsupported:
        raise DeclarationError('Unsupported scene opcodes: ' + repr(unsupported))
    regs = [None] * 256
    initialized = set()
    globals_, calls, fields = {}, [], []
    multi_top = None

    def reg(index):
        if index not in initialized:
            raise DeclarationError('Uninitialized register ' + str(index))
        return regs[index]

    def put(index, value):
        if index >= fn['frames'] or index >= 256:
            raise DeclarationError('Register exceeds frame')
        regs[index] = value
        initialized.add(index)

    def gc(index):
        if index >= len(fn['gc']):
            raise DeclarationError('GC index out of range')
        return fn['gc'][index]

    def get(target, key):
        return target.get(key) if plain_table(target) else {'$field': key, 'target': target}

    for pc, word in enumerate(code):
        op, a, b, c, d = word & 255, word >> 8 & 255, word >> 24, word >> 16 & 255, word >> 16
        opname = OP_NAMES[op]
        try:
            if opname == 'MOV':
                put(a, reg(d))
            elif opname == 'KSTR':
                value = gc(d)
                if not isinstance(value, str):
                    raise DeclarationError('KSTR requires string')
                put(a, value)
            elif opname == 'KSHORT':
                put(a, d if d < 32768 else d - 65536)
            elif opname == 'KNUM':
                put(a, fn['numbers'][d])
            elif opname == 'KPRI':
                if d > 2:
                    raise DeclarationError('Invalid primitive constant')
                put(a, (None, False, True)[d])
            elif opname == 'KNIL':
                if d < a:
                    raise DeclarationError('Invalid nil range')
                for i in range(a, d + 1):
                    put(i, None)
            elif opname == 'GGET':
                key = gc(d)
                if not isinstance(key, str):
                    raise DeclarationError('Global name is not string')
                put(a, globals_.get(key, symbol(key)))
            elif opname == 'GSET':
                key = gc(d)
                globals_[key] = reg(a)
            elif opname == 'TNEW':
                put(a, {})
            elif opname == 'TDUP':
                table = gc(d)
                if not plain_table(table):
                    raise DeclarationError('TDUP requires literal table')
                put(a, copy.deepcopy(table))
            elif opname.startswith('TGET'):
                key = gc(c) if opname == 'TGETS' else reg(c) if opname == 'TGETV' else c
                put(a, get(reg(b), key))
            elif opname.startswith('TSET'):
                key = gc(c) if opname == 'TSETS' else reg(c) if opname == 'TSETV' else c
                target, value = reg(b), reg(a)
                if plain_table(target):
                    target[key] = value
                else:
                    fields.append({'target': copy.deepcopy(target), 'field': key,
                                   'value': copy.deepcopy(value), 'pc': pc})
            elif opname in ('CALL', 'CALLM'):
                target = reg(a)
                if opname == 'CALLM':
                    if multi_top is None:
                        raise DeclarationError('Unknown multiple-result stack')
                    # The only permitted open return is one literal constructor
                    # value, immediately following the C fixed arguments.
                    if multi_top != a + c + 2:
                        raise DeclarationError('Open argument stack/arity mismatch')
                    stop = multi_top
                else:
                    if c == 0:
                        raise DeclarationError('Invalid CALL argument count')
                    stop = a + c
                args = [reg(i) for i in range(a + 1, stop)]
                # Lua method lowering explicitly places the receiver first.
                receiver = target.get('target') if isinstance(target, dict) and '$field' in target else None
                if receiver is not None:
                    if not args or args[0] != receiver:
                        raise DeclarationError('Method receiver mismatch')
                    args = args[1:]
                    callee = str(target['$field'])
                else:
                    callee = display(target)
                call = {'id': len(calls), 'target': copy.deepcopy(receiver),
                        'callee': callee, 'arguments': copy.deepcopy(args), 'pc': pc}
                calls.append(call)
                if b not in (0, 1, 2):
                    raise DeclarationError('Multiple fixed native returns unsupported')
                if b != 1:
                    if b == 0 and callee not in ('D3DXVECTOR3', 'D3DXCOLOR'):
                        raise DeclarationError('Unproved native open return')
                    if callee in ('D3DXVECTOR3', 'D3DXCOLOR'):
                        count = 3 if callee == 'D3DXVECTOR3' else 4
                        if len(args) != count or any(type(x) not in (int, float) for x in args):
                            raise DeclarationError('Invalid vector/color constructor')
                        value = {'$constructor': callee, 'values': args}
                    else:
                        value = {'$result': call['id']}
                    put(a, value)
                    call['result'] = copy.deepcopy(value)
                multi_top = a + 1 if b == 0 else None
            elif opname == 'RET0':
                if pc != len(code) - 1 or d != 1:
                    raise DeclarationError('Early return')
            else:
                raise DeclarationError('Unimplemented opcode')
        except (IndexError, KeyError, TypeError) as exc:
            raise DeclarationError(f'Invalid operands at pc {pc}: {exc}') from exc
        except DeclarationError as exc:
            raise DeclarationError(f'{opname} at pc {pc}: {exc}') from exc
    if not code or code[-1] & 255 != 0x47:
        raise DeclarationError('Missing final RET0')
    return {'calls': calls, 'fields': fields, 'globals': copy.deepcopy(globals_),
            'instructionCount': len(code), 'nativeExecuted': False,
            'evidence': 'static declaration recovery using V5 mapped opcode subset'}


def recover(data):
    return reduce_parsed(parse(data))


def vector(value):
    if isinstance(value, dict) and value.get('$constructor') == 'D3DXVECTOR3':
        return value['values']
    return value
