"""Read KL82 declarations without running Lua or native game callbacks.

Only a straight-line declaration subset is accepted. The opcode layout is
cross-checked against V5 KlTranslate.cs, but its claimed general compatibility
does not establish 2016 behavior. Branches and unknown opcodes fail closed.
Optional call capture records operands, without executing a native function.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import struct
from pathlib import Path


class Unsupported(ValueError):
    pass


class Reader:
    def __init__(self, data: bytes):
        self.data, self.pos = data, 0

    def take(self, n: int) -> bytes:
        if n < 0 or self.pos + n > len(self.data):
            raise ValueError("Truncated KL82 container")
        out = self.data[self.pos:self.pos + n]
        self.pos += n
        return out

    def uleb(self, bits=32) -> int:
        out = 0
        for n in range(5):
            byte = self.take(1)[0]
            if n == 4 and byte >= (1 << (bits - 28)):
                raise ValueError("ULEB128 overflow")
            out |= (byte & 127) << (7 * n)
            if not byte & 128:
                return out
        raise ValueError("Invalid ULEB128")

    def number(self, low=None):
        low = self.uleb() if low is None else low
        value = struct.unpack("<d", struct.pack("<II", low, self.uleb()))[0]
        if not math.isfinite(value):
            raise ValueError("Non-finite numeric constant")
        return value

    def table_value(self):
        tag = self.uleb()
        if tag >= 5:
            return decode_string(self.take(tag - 5))
        if tag == 3:
            v = self.uleb()
            return v if v < 0x80000000 else v - 0x100000000
        if tag == 4:
            return self.number()
        if tag <= 2:
            return (None, False, True)[tag]
        raise ValueError("Invalid table constant tag")

    def table(self):
        narray, npairs = self.uleb(), self.uleb()
        if narray + npairs > len(self.data):
            raise ValueError("Invalid table constant counts")
        result = {}
        for key in range(narray):
            value = self.table_value()
            if value is not None:
                result[key] = value
        for _ in range(npairs):
            key, value = self.table_value(), self.table_value()
            if key is None or isinstance(key, (dict, list)):
                raise ValueError("Invalid table constant key")
            if value is not None:
                result[key] = value
        return result


def decode_string(value: bytes):
    for encoding in ("utf-8", "cp949", "cp1252"):
        try:
            return value.decode(encoding)
        except UnicodeError:
            pass
    return {"$bytes": value.hex(), "$unsupported": "string encoding"}


def parse(data: bytes):
    r = Reader(data)
    if r.take(4) != b"\x1bKL\x82":
        raise ValueError("Expected KL82 magic")
    flags = r.uleb()
    if flags & ~7 or flags & 1:
        raise ValueError("Unknown KL flags or unsupported big-endian encoding")
    name = None if flags & 2 else decode_string(r.take(r.uleb()))
    prototypes, children = [], []
    while True:
        size = r.uleb()
        if not size:
            break
        p = Reader(r.take(size))
        pflags, params, frame_size, nuv = p.take(4)
        ngc, nn, ni = p.uleb(), p.uleb(), p.uleb()
        if ngc + nn + ni > size:
            raise ValueError("Invalid prototype counts")
        ndebug = firstline = line_span = 0
        if not flags & 2:
            ndebug = p.uleb()
            if ndebug:
                firstline, line_span = p.uleb(), p.uleb()
        instructions = list(struct.unpack(f"<{ni}I", p.take(ni * 4)))
        upvalues = p.take(nuv * 2).hex()
        gc = []
        for _ in range(ngc):
            tag = p.uleb()
            if tag >= 5:
                gc.append(decode_string(p.take(tag - 5)))
            elif tag == 1:
                gc.append(p.table())
            elif tag == 0:
                if not children:
                    raise ValueError("Child prototype stack underflow")
                gc.append({"$prototype": children.pop()})
            elif tag in (2, 3, 4):
                gc.append({"$unsupported": "cdata", "type": tag,
                           "words": [p.uleb() for _ in range(4 if tag == 4 else 2)]})
            else:
                raise ValueError("Unknown GC tag")
        numbers = []
        for _ in range(nn):
            # LuaJIT stores the numeric tag in the low bit: the low word can
            # occupy 33 bits until that tag is shifted away.
            low = p.uleb(bits=33)
            if low & 1:
                numbers.append(p.number(low >> 1))
            else:
                value = low >> 1
                numbers.append(value if value < 0x80000000 else value - 0x100000000)
        p.take(ndebug)
        if p.pos != len(p.data):
            raise ValueError("Extra bytes in prototype")
        prototypes.append(dict(id=len(prototypes), flags=pflags, params=params,
                               frame_size=frame_size, upvalues=upvalues,
                               instructions=instructions, gc=gc, numbers=numbers,
                               firstline=firstline, line_span=line_span))
        children.append(len(prototypes) - 1)
    if r.pos != len(data) or len(children) != 1:
        raise ValueError("Invalid KL82 end or root stack")
    return dict(format="KL82", flags=flags, name=name, prototypes=prototypes)


# Exact subset used in the RF declaration sample; no identity fallback.
OPS = {
    0x0c: "MOV", 0x0e: "UNM", 0x14: "KSTR", 0x16: "KSHORT",
    0x17: "KNUM", 0x18: "KPRI", 0x19: "KNIL", 0x1a: "ADDVN",
    0x1b: "SUBVN", 0x1c: "MULVN", 0x1d: "DIVVN", 0x1f: "ADDNV",
    0x20: "SUBNV", 0x21: "MULNV", 0x22: "DIVNV", 0x24: "ADDVV",
    0x25: "SUBVV", 0x26: "MULVV", 0x27: "DIVVV", 0x2b: "CALLM", 0x2c: "CALL", 0x38: "UCLO", 0x39: "FNEW",
    0x3a: "TNEW", 0x3b: "TDUP", 0x3c: "GGET", 0x3d: "GSET",
    0x3e: "TGETV", 0x3f: "TGETS", 0x40: "TGETB", 0x41: "TSETV",
    0x42: "TSETS", 0x43: "TSETB", 0x47: "RET0",
}


def symbolic(path):
    return {"$symbol": path, "$unsupported": "native/global value not resolved"}


def field(table, key):
    if isinstance(table, dict) and "$symbol" in table:
        if key in table.get("$writes", {}):
            return table["$writes"][key]
        return symbolic(f"{table['$symbol']}.{key}")
    if isinstance(table, dict):
        return table.get(key)
    raise Unsupported(f"Index into non-table {type(table).__name__}")


def arithmetic(op, left, right):
    if type(left) in (int, float) and type(right) in (int, float):
        if op.startswith("ADD"):
            return left + right
        if op.startswith("SUB"):
            return left - right
        if op.startswith("MUL"):
            return left * right
        if op.startswith("DIV"):
            if right == 0:
                raise ValueError("Division by zero")
            return left / right
    return {"$expression": op, "left": left, "right": right,
            "$unsupported": "unresolved arithmetic operand"}


def declarations(chunk, globals_in=None, capture_calls=False, capture_unresolved=False):
    p = chunk["prototypes"][-1]
    if p["params"] or p["upvalues"]:
        raise Unsupported("Root arguments/upvalues are not static declarations")
    regs = [None] * max(p["frame_size"], 256)
    globals_out = copy.deepcopy(globals_in or {})
    assigned, source_ranges, calls = {}, {}, []

    def gc(i):
        if i >= len(p["gc"]):
            raise ValueError("GC operand out of bounds")
        return p["gc"][-1 - i]

    def num(i):
        if i >= len(p["numbers"]):
            raise ValueError("Number operand out of bounds")
        return p["numbers"][i]

    ended = False
    for pc, word in enumerate(p["instructions"]):
        opcode, a, b, c, d = word & 255, (word >> 8) & 255, word >> 24, (word >> 16) & 255, word >> 16
        if opcode not in OPS:
            raise Unsupported(f"Prototype {p['id']} instruction {pc}: opcode 0x{opcode:02x} is unsupported")
        op = OPS[opcode]
        if op in ('MOV', 'UNM') and d >= len(regs):
            raise ValueError('Register operand out of bounds')
        if op == "MOV":
            regs[a] = regs[d]
        elif op == "UNM":
            value = regs[d]
            regs[a] = -value if isinstance(value, (float, int)) else {"$expression": "negate", "value": value, "$unsupported": "unresolved operand"}
        elif op == "KSTR":
            value = gc(d)
            if not isinstance(value, str):
                raise ValueError("KSTR operand is not a string")
            regs[a] = value
        elif op == "KSHORT":
            regs[a] = d if d < 0x8000 else d - 0x10000
        elif op == "KNUM":
            regs[a] = num(d)
        elif op == "KPRI":
            if d > 2:
                raise ValueError("Invalid primitive")
            regs[a] = (None, False, True)[d]
        elif op == "KNIL":
            if d >= len(regs) or d < a:
                raise ValueError("Invalid nil range")
            for index in range(a, d + 1):
                regs[index] = None
        elif op.endswith(("VN", "NV", "VV")):
            left, right = (regs[b], num(c)) if op.endswith("VN") else (num(c), regs[b]) if op.endswith("NV") else (regs[b], regs[c])
            regs[a] = arithmetic(op, left, right)
        elif op in ("CALL", "CALLM"):
            if not capture_calls:
                raise Unsupported(f"Native call at instruction {pc}; call capture not enabled")
            if (b == 0 or c == 0 or op == "CALLM") and not capture_unresolved:
                raise Unsupported(f"Variable argument/result call at instruction {pc}")
            callable_value = regs[a]
            if not isinstance(callable_value, dict) or not any(k in callable_value for k in ("$symbol", "$prototype")):
                raise Unsupported(f"Non-symbolic call at instruction {pc}")
            target = callable_value.get("$symbol", f"script-prototype@{callable_value.get('$prototype')}")
            arguments = copy.deepcopy(regs[a + 1:a + c]) if c else [{"$unsupported": "variable argument count", "base": a}]
            if op == "CALLM":
                arguments.append({"$unsupported": "multiple results appended as arguments"})
            call = dict(target=target, args=arguments,
                        prototype=p["id"], instruction=pc,
                        execution="not-executed", nativeEffects="unsupported",
                        argumentOperand=c, resultOperand=b, opcode=op,
                        scriptEffects="unsupported" if "$prototype" in callable_value else None)
            calls.append(call)
            for result_index in range(b - 1 if b else len(regs) - a):
                regs[a + result_index] = symbolic(f"call@{len(calls) - 1}.return{result_index}")
        elif op == "FNEW":
            value = gc(d)
            if not isinstance(value, dict) or "$prototype" not in value:
                raise ValueError("FNEW operand is not a child")
            regs[a] = copy.deepcopy(value)
            regs[a]["$unsupported"] = "function body not executed"
        elif op == "TNEW":
            regs[a] = {}
        elif op == "TDUP":
            value = gc(d)
            if not isinstance(value, dict) or any(str(k).startswith("$") for k in value):
                raise ValueError("TDUP operand is not a table")
            regs[a] = copy.deepcopy(value)
        elif op == "GGET":
            key = gc(d)
            if not isinstance(key, str):
                raise ValueError('Global key is not a string')
            regs[a] = globals_out.get(key, symbolic(key))
        elif op == "GSET":
            key = gc(d)
            if not isinstance(key, str):
                raise ValueError("Global key is not a string")
            globals_out[key] = regs[a]
            assigned[key] = regs[a]
            source_ranges[key] = {"prototype": p["id"], "assignmentInstruction": pc}
        elif op.startswith("TGET"):
            key = gc(c) if op == "TGETS" else c if op == "TGETB" else regs[c]
            regs[a] = field(regs[b], key)
        elif op.startswith("TSET"):
            key = gc(c) if op == "TSETS" else c if op == "TSETB" else regs[c]
            if not isinstance(regs[b], dict):
                raise Unsupported(f"Write to unresolved table at instruction {pc}")
            if not isinstance(key, (str, int, float)):
                raise Unsupported(f"Unresolved table key at instruction {pc}")
            if "$symbol" in regs[b]:
                if not capture_unresolved:
                    raise Unsupported(f"Write to unresolved table at instruction {pc}")
                regs[b].setdefault("$writes", {})[key] = regs[a]
            else:
                regs[b][key] = regs[a]
        elif op == "UCLO":
            if d != 0x8000:
                raise Unsupported(f"UCLO with a branch at instruction {pc}")
            # Closing symbolic unexecuted closures does not evaluate them.
        elif op == "RET0":
            if pc != len(p["instructions"]) - 1:
                raise Unsupported("Early return is not a declaration block")
            ended = True
    if not ended:
        raise ValueError("Missing static root return")
    return assigned, source_ranges, calls


def read_declarations(path, globals_in=None, capture_calls=False, capture_unresolved=False):
    path = Path(path)
    raw = path.read_bytes()
    assigned, sources, calls = declarations(parse(raw), globals_in, capture_calls, capture_unresolved)
    if path.is_absolute():
        workdir = Path.cwd()
        assets = (workdir / 'asset_work').resolve()
        if path.is_relative_to(workdir):
            path = path.relative_to(workdir)
        elif path.is_relative_to(assets):
            # Keep declarations readable through a repository-local asset mount.
            path = Path('asset_work') / path.relative_to(assets)
    return dict(source=dict(path=path.as_posix(), sha256=hashlib.sha256(raw).hexdigest()),
                evidence="static-2016-declaration", globals=assigned, locations=sources,
                nativeCalls=calls)


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("input", type=Path)
    cli.add_argument("--output", type=Path, required=True)
    cli.add_argument("--globals", type=Path)
    cli.add_argument("--capture-native-calls", action="store_true")
    cli.add_argument("--capture-unresolved", action="store_true",
                     help="Capture symbolic unknown return writes/varargs; do not execute or resolve them")
    args = cli.parse_args()
    prior = json.loads(args.globals.read_text(encoding="utf-8"))["globals"] if args.globals else None
    result = read_declarations(args.input, prior, args.capture_native_calls, args.capture_unresolved)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(dict(source=result["source"], globals=len(result["globals"])), ensure_ascii=False))
