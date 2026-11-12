const key=(code,label,width=1)=>({code,label,width});
const letters=value=>[...value].map(letter=>key('Key'+letter,letter));
const digits=value=>[...value].map(digit=>key('Digit'+digit,digit));
const gap=width=>({width});
export const KEYBOARD_MAIN_ROWS=[
  [key('Escape','Esc'),gap(1),...Array.from({length:12},(_,i)=>key('F'+(i+1),'F'+(i+1))),gap(1)],
  [key('Backquote','~'),...digits('1234567890'),key('Minus','−'),key('Equal','='),key('Backspace','Backspace',2)],
  [key('Tab','Tab',1.5),...letters('QWERTYUIOP'),key('BracketLeft','['),key('BracketRight',']'),key('Backslash','\\',1.5)],
  [key('CapsLock','Caps',1.75),...letters('ASDFGHJKL'),key('Semicolon',';'),key('Quote',"'"),key('Enter','Enter',2.25)],
  [key('ShiftLeft','Shift',2.25),...letters('ZXCVBNM'),key('Comma',','),key('Period','.'),key('Slash','/'),key('ShiftRight','Shift',2.75)],
  [key('ControlLeft','Ctrl',1.25),key('MetaLeft','Win',1.25),key('AltLeft','Alt',1.25),key('Space','Space',6.25),key('AltRight','Alt',1.25),key('MetaRight','Win',1.25),key('ContextMenu','Menu',1.25),key('ControlRight','Ctrl',1.25)],
];
export const KEYBOARD_NAV_ROWS=[
  [key('PrintScreen','PrtSc'),key('ScrollLock','ScrLk'),key('Pause','Pause')],
  [key('Insert','Ins'),key('Home','Home'),key('PageUp','PgUp')],
  [key('Delete','Del'),key('End','End'),key('PageDown','PgDn')],
  [gap(3)], [gap(1),key('ArrowUp','↑'),gap(1)],
  [key('ArrowLeft','←'),key('ArrowDown','↓'),key('ArrowRight','→')],
];
export const KEYBOARD_NUMPAD=[
  {...key('NumLock','Num'),column:1,row:2}, {...key('NumpadDivide','/'),column:2,row:2},
  {...key('NumpadMultiply','×'),column:3,row:2}, {...key('NumpadSubtract','−'),column:4,row:2},
  ...[7,8,9,4,5,6,1,2,3].map((n,i)=>({...key('Numpad'+n,String(n)),column:i%3+1,row:Math.floor(i/3)+3})),
  {...key('NumpadAdd','+'),column:4,row:3,rows:2}, {...key('NumpadEnter','Enter'),column:4,row:5,rows:2},
  {...key('Numpad0','0'),column:1,row:6,columns:2}, {...key('NumpadDecimal','.'),column:3,row:6},
];

export function createKeyboardPreview(doc){
  const board=doc.createElement('div');board.className='rf-keyboard';
  const makeKey=item=>{
    const node=doc.createElement('span');node.style.flex=String(item.width);
    if(item.code){node.dataset.code=item.code;node.textContent=item.label;node.title=item.label;}
    else {node.className='rf-key-gap';node.setAttribute('aria-hidden','true');}
    return node;
  };
  for(const [name,rows]of [['main',KEYBOARD_MAIN_ROWS],['nav',KEYBOARD_NAV_ROWS]]){
    const region=doc.createElement('div');region.className='rf-keyboard-'+name;
    for(const items of rows){const row=doc.createElement('div');row.className='rf-keyboard-row';for(const item of items)row.append(makeKey(item));region.append(row);}
    board.append(region);
  }
  const numpad=doc.createElement('div');numpad.className='rf-keyboard-numpad';
  for(const item of KEYBOARD_NUMPAD){const node=makeKey(item);node.style.gridColumn=item.column+' / span '+(item.columns??1);node.style.gridRow=item.row+' / span '+(item.rows??1);numpad.append(node);}
  board.append(numpad);return board;
}
