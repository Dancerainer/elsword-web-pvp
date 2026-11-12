"""Hash/locate fixed reference callbacks without copying third-party source into Git."""
from pathlib import Path
import argparse, hashlib, json, re

def build(path, output):
    data=path.read_bytes();src=data.decode('latin1')
    # Keep byte offsets and physical newlines. Braces in comments/strings are not syntax.
    token=re.compile(r'/\*[\s\S]*?\*/|//[^\r\n]*|L?"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'')
    def blank(m):return ''.join(c if c in '\r\n' else ' ' for c in m.group())
    masked=token.sub(blank,src)
    pattern=re.compile(r'^[^\r\n;{}#]*\bCX2GUEL::(\w+)\s*\([^;{}]*\)\s*(?:const\s*)?\{',re.M)
    methods=[]
    for m in pattern.finditer(masked):
        start=m.start();i=m.end();depth=1
        while i<len(masked) and depth:
            depth+=(masked[i]=='{')-(masked[i]=='}');i+=1
        if depth:raise ValueError('Unclosed callback '+m.group(1))
        raw=data[start:i];body=src[start:i]
        # Resource identifiers are ASCII in this source; retain literal identity only.
        resources=sorted(set(re.findall(r'L"([^"\r\n]+)"',body)))
        methods.append(dict(method=m.group(1),line=src.count('\n',0,start)+1,lastLine=src.count('\n',0,i)+1,
          sha256=hashlib.sha256(raw).hexdigest(),literalResources=resources,contains2026='2026' in body))
    result=dict(schemaVersion=1,targetClientMeasured=False,source=dict(path='X2Lib/X2GUEL.cpp',sha256=hashlib.sha256(data).hexdigest(),
      gitBlob=hashlib.sha1(('blob '+str(len(data))+'\0').encode()+data).hexdigest(),commit='a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
      evidenceClass='fixedV5-with-2026-reconstruction-not-target2016'),
      methodLocationPolicy='Physical LF line numbers and unmodified-byte body SHA; contains2026 only reports a literal marker within body, not historical provenance. All methods remain qualified fixed-reference candidates.',methods=methods)
    output.write_text(json.dumps(result,indent=2)+'\n',encoding='utf8')
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,default=Path('contracts/elesis-skill-reference-v1.json'));a=p.parse_args();build(a.source,a.output)
