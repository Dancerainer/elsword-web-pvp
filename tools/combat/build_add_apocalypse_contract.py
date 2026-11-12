"""Freeze small original NPC tables and static callback provenance. Never execute Lua."""
import argparse, hashlib, json, struct
from pathlib import Path
from kl82_static import parse

def build(declarations, output):
    d = json.loads(Path(declarations).read_text('utf-8'))
    raw = Path(d['source']['path']).read_bytes()
    if hashlib.sha256(raw).hexdigest() != d['source']['sha256']:
        raise ValueError('Original Apocalypse source changed')
    protos = parse(raw)['prototypes']
    names = ['WAIT_FRAME_MOVE', 'ATTACK_B_FRAME_MOVE', 'ATTACK_A_FRAME_MOVE', 'ATTACK_C_FRAME_MOVE',
             'ATTACK_STATE_END', 'DIE_ATTACK_STATE_START', 'FindTarget', 'AttackFunction', 'COMMON_FRAME_FUNC', 'START_STATE_START']
    if len(protos) != 11:  # ten callbacks plus top-level declaration prototype
        raise ValueError('Original callback count changed')
    callbacks = [dict(name=name, prototype=p['id'], params=p['params'], instructions=len(p['instructions']),
                     instructionSha256=hashlib.sha256(struct.pack('<%dI' % len(p['instructions']), *p['instructions'])).hexdigest(),
                     numericConstants=p['numbers'], literalCalls=[v for v in p['gc'] if isinstance(v, str)])
                 for name, p in zip(names, protos[:10])]
    g = d['globals']
    selected = {k: v for k,v in g.items() if k in ['INIT_SYSTEM','INIT_COMPONENT','INIT_STATE','INIT_AI'] or
                k.startswith('APOCALYPSE_') and isinstance(v,dict) and 'ANIM_NAME' in v}
    result = dict(schemaVersion=1,targetClientMeasured=False,source=d['source'],tables=selected,callbacks=callbacks,
      semantics=dict(wait='owner +/- original line direction * -333; Y+100 right /+50 left; goal*.1+old*.9 each callback',
       findTarget='nearest enemy from owner within700 in game type1; static prototype6',
       aim='wrap target-relative Z angle delta then clamp +/-3 per callback; generic degree helper is an adapter',
       fire='B:.4 aim before fire; A:1.4/C:1.8 aim after fire; PvP-specific set names from original nested TDUP constants',
       finish='explicit FINISH state runs source ownerX+dirX*150*facing position callback; HP0 selects declared DYING_* DIE state',
       emergency='original common callback owner.ResponseEmergency moves to owner+dir*20 and enters A_EMERGENCY',
       stats='2016 skill29601/29604 description shares HP/Attack/Defence/Critical; Web uses frozen base attributes without owner buffs',
       startVisual='Original callback9 grants BFI_APOCALYPSE_EFFECT443 -> template414, EMPTY behavior; bind Always displayer to original NPC bones until NPC removal'),
      qualifiedAdapters=['generic NPC interval/condition arbitration is static adaptation, native NPC consumer not acquired',
       'spawn at animation .01 and forward300 use fixed Add.cpp containing later reconstruction',
       'manual/expiry/owner-death FINISH selection is Web adaptation; fixed reconstructed helper says DIE and conflicts with its comment',
       'NPC stat copy and damage formula use target description plus existing fixed PvP/critical math; NPC-only modifiers unresolved',
       'original GetDirVecToDegree uses Web pitch calculation; target executable not measured'],
      sourceVersionReference=dict(commit='a8438f3ed18dd6f0944793de6c0d8bb9334e9633',file='X2GUAdd.cpp',
       sha256='b9ea0a23c074dfb366a9886823d046ad419acc474c53ae6ccd5c71ab3071de6a'))
    Path(output).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n','utf-8')

if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--declarations',required=True);p.add_argument('--output',required=True)
    a=p.parse_args();build(a.declarations,a.output)
