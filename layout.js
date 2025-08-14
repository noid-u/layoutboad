(function(){
  try{
    "use strict";

    var $ = function(sel, el){ return (el||document).querySelector(sel); };
    var $$ = function(sel, el){ return Array.prototype.slice.call((el||document).querySelectorAll(sel)); };
    var clamp = function(v,min,max){ return Math.max(min,Math.min(max,v)); };
    var uid = function(){ return 'n'+Math.random().toString(36).slice(2,9); };

    var viewport = $('#viewport');
    var stageWrap = $('#stageWrap');
    var stage = $('#stage');
    var connLayer = $('#connLayer');
    var marquee = $('#marquee');

    /* ===== Undo/Redo History ===== */
    var hist = [];      // Array<stateObj>
    var redoStack = [];
    var HIST_MAX = 200;

    function serialize(){
      return {
        nodes: $$('.node', stage).map(nodeToData),
        connections: connections.map(function(c){ return {id:c.id, from:c.from, to:c.to, fa:c.fa, ta:c.ta, stroke:c.stroke, color:c.color, arrowStart:c.arrowStart, arrowEnd:c.arrowEnd}; })
      };
    }
    function snapshot(){ return serialize(); }
    function statesEqual(a,b){ try{ return JSON.stringify(a)===JSON.stringify(b); }catch(_){ return false; } }
    function pushHistory(){ var state = snapshot(); var last = hist.length ? hist[hist.length-1] : null; if(last && statesEqual(last, state)) return; hist.push(state); if(hist.length>HIST_MAX) hist.shift(); redoStack.length = 0; updateUndoUI(); }
    function resetHistory(){ hist = [ snapshot() ]; redoStack.length = 0; updateUndoUI(); }
    function undo(){ if(hist.length<=1) return; var cur = hist.pop(); redoStack.push(cur); loadFrom(hist[hist.length-1]); updateUndoUI(); }
    function redo(){ if(redoStack.length===0) return; var next = redoStack.pop(); hist.push(next); loadFrom(next); updateUndoUI(); }
    function updateUndoUI(){ var u = $('#btnUndo'), r = $('#btnRedo'); if(u) u.disabled = hist.length<=1; if(r) r.disabled = redoStack.length===0; }

    /* ===== ズーム ===== */
    var zoom = 1;
    function setZoom(z){ zoom = clamp(z, 0.3, 2.0); stageWrap.style.transform = 'scale('+zoom+')'; $('#zoomLabel').textContent = Math.round(zoom*100) + '%'; }
    function zoomIn(){ setZoom(zoom + 0.1); } function zoomOut(){ setZoom(zoom - 0.1); } function zoomReset(){ setZoom(1); }
    $('#zoomIn').addEventListener('click', zoomIn); $('#zoomOut').addEventListener('click', zoomOut); $('#zoomReset').addEventListener('click', zoomReset);
    viewport.addEventListener('wheel', function(e){ if(e.ctrlKey){ e.preventDefault(); var dir = e.deltaY > 0 ? -0.1 : 0.1; setZoom(zoom + dir); } }, {passive:false});

    /* ===== グリッド ===== */
    var gridRange = $('#gridSize'); var gridLabel = $('#gridSizeLabel'); var snapBox = $('#snap'); var gridToggle = $('#gridToggle');
    function applyGrid(size){ document.documentElement.style.setProperty('--grid', size+'px'); normalizeCanvasToGrid(); updateConnLayerSize(); }
    gridRange.addEventListener('input', function(){ gridLabel.textContent = gridRange.value; applyGrid(+gridRange.value); });
    function setGridVisible(on){ document.body.classList.toggle('grid-off', !on); }
    gridToggle.addEventListener('change', function(){ setGridVisible(gridToggle.checked); });
    setGridVisible(true);

    function updateConnLayerSize(){
      connLayer.setAttribute('width', stage.clientWidth);
      connLayer.setAttribute('height', stage.clientHeight);
      connLayer.setAttribute('viewBox', '0 0 '+stage.clientWidth+' '+stage.clientHeight);
    }

    /* ===== パレット：DnD + クリック追加 ===== */
    var palette = $('#paletteItems');
    $$('.item', palette).forEach(function(it){
      it.addEventListener('dragstart', function(e){
        try{
          e.dataTransfer.setData('text/plain', JSON.stringify({
            t: it.dataset.type,
            w: +it.dataset.w||80,
            h: +it.dataset.h||40,
            text: it.dataset.text||'',
            textMode:'auto'
          }));
          e.dataTransfer.effectAllowed = 'copy';
        }catch(err){ /* setData失敗対策 */ }
      });
      it.addEventListener('click', function(){
        var rect = viewport.getBoundingClientRect();
        var centerClient = {x: rect.left + rect.width/2, y: rect.top + rect.height/2};
        var p = clientToStage(centerClient.x, centerClient.y);
        var w = +it.dataset.w||80, h = +it.dataset.h||40;
        var gx = +gridRange.value;
        var x = p.x - w/2, y = p.y - h/2;
        if(snapBox.checked){ x = Math.round(x/gx)*gx; y = Math.round(y/gx)*gx; }
        addNode({type: it.dataset.type, x:x, y:y, w:w, h:h, text: it.dataset.text||'', textMode:'auto'});
        pushHistory();
      });
    });

    // DnD受け側
    ['dragenter','dragover'].forEach(function(evName){ [viewport, stageWrap, stage].forEach(function(el){ el.addEventListener(evName, function(e){ e.preventDefault(); }, false); }); });
    stageWrap.addEventListener('drop', function(e){
      e.preventDefault(); e.stopPropagation();
      var dt = e.dataTransfer; if(!dt) return;
        var text = ''; try{ text = dt.getData('text/plain'); }catch(_){}
        if(!text) return;
        var rec; try{ rec = JSON.parse(text); }catch(_){ return; }
        var p = clientToStage(e.clientX, e.clientY);
        var gx = +gridRange.value;
        var x = p.x - rec.w/2, y = p.y - rec.h/2;
        if(snapBox.checked){ x = Math.round(x/gx)*gx; y = Math.round(y/gx)*gx; }
        addNode({type:rec.t,x:x,y:y,w:rec.w,h:rec.h,text:rec.text,textMode:rec.textMode||'auto'});
        pushHistory();
      }, false);

    /* ===== 既定スタイル ===== */
    var typeDefaults = {
      rect:   {bg:'#e5e7eb', fg:'#111111', radius:8,  bw:1, bs:'solid', bc:'#94a3b8', alpha:1},
      circle: {bg:'#e5e7eb', fg:'#111111', radius:9999, bw:1, bs:'solid', bc:'#94a3b8', alpha:1},
      triangle:{bg:'#e5e7eb', fg:'#111111', radius:0,  bw:1, bs:'solid', bc:'#94a3b8', alpha:1},
      star:   {bg:'#e5e7eb', fg:'#111111', radius:0,  bw:1, bs:'solid', bc:'#94a3b8', alpha:1},
      line:   {color:'#64748b', strokeW:2},
      desk:   {bg:'#fefce8', fg:'#111111', radius:8,  bw:1, bs:'solid', bc:'#eab308', alpha:1},
      chair:  {bg:'#ecfeff', fg:'#111111', radius:8,  bw:1, bs:'solid', bc:'#06b6d4', alpha:1},
      pc:     {bg:'#eef2ff', fg:'#111111', radius:8,  bw:1, bs:'solid', bc:'#6366f1', alpha:1},
      phone:  {bg:'#ffe4e6', fg:'#111111', radius:8,  bw:1, bs:'solid', bc:'#fb7185', alpha:1},
      label:  {bg:'#f1f5f9', fg:'#111111', radius:8,  bw:1, bs:'dotted', bc:'#94a3b8', alpha:1}
    };

    function setNodeBackground(el, baseHex, alpha){
      var base = baseHex || el.dataset.bgBase || '#ffffff';
      var a = (alpha!=null ? alpha : (el.dataset.bgAlpha!=null ? +el.dataset.bgAlpha : 1));
      el.dataset.bgBase = base;
      el.dataset.bgAlpha = a;
      var shape = el.querySelector('.shape');
      if(shape){ shape.style.background = makeRgba(base, a); }
    }

    /* ===== ノード生成 ===== */
    function createLineNode(opts){
      var type=opts.type,x=opts.x||0,y=opts.y||0;
      var el = document.createElement('div');
      el.draggable = false;
      el.className = 'node';
      el.dataset.type = type;
      el.dataset.id = uid();
      el.dataset.rotate = (opts.rotate||0);
      el.dataset.textMode = opts.textMode || 'auto';
      el.tabIndex = 0;
      var d = typeDefaults.line;
      el.style.left = x+'px'; el.style.top = y+'px';
      el.style.width = '1px'; el.style.height = '1px';
      el.dataset.x1 = opts.x1!=null? +opts.x1 : 0;
      el.dataset.y1 = opts.y1!=null? +opts.y1 : 0;
      el.dataset.x2 = opts.x2!=null? +opts.x2 : 160;
      el.dataset.y2 = opts.y2!=null? +opts.y2 : 0;
      el.dataset.strokeW = opts.strokeW!=null? +opts.strokeW : d.strokeW;
      el.dataset.color = opts.color || d.color;
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.classList.add('line-svg');
      var ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      svg.appendChild(ln);
      el.appendChild(svg);
      var ep1 = document.createElement('div'); ep1.className='endpoint ep1';
      var ep2 = document.createElement('div'); ep2.className='endpoint ep2';
      el.appendChild(ep1); el.appendChild(ep2);
      stage.appendChild(el);
      normalizeLineBBox(el);
      updateLineGraphics(el);
      enableLineInteractions(el);
      return el;
    }

    function createShapeNode(opts){
      var type=opts.type,x=opts.x||0,y=opts.y||0,w=opts.w,h=opts.h,text=opts.text,bg=opts.bg,fg=opts.fg,radius=opts.radius,rotate=opts.rotate,fontSize=opts.fontSize,textMode=opts.textMode;
      var bw=opts.borderW, bs=opts.borderS, bc=opts.borderC, bgAlpha=opts.bgAlpha;
      var el = document.createElement('div');
      el.draggable = false;
      el.className = 'node';
      el.dataset.type = type;
      el.dataset.id = uid();
      el.dataset.rotate = (rotate||0);
      el.dataset.textMode = textMode || 'auto';
      el.tabIndex = 0;
      var d = typeDefaults[type]||{bg:'#fff',fg:'#111',radius:8,bw:1,bs:'solid',bc:'#cbd5e1',alpha:1};
      el.style.left = clamp(x,0,stage.clientWidth - (w||80)) + 'px';
      el.style.top  = clamp(y,0,stage.clientHeight - (h||40)) + 'px';
      el.style.width = (w||80) + 'px';
      el.style.height = (h||40) + 'px';
      el.style.borderRadius = ((radius!=null)? radius : d.radius) + 'px';
      el.style.transform = 'rotate('+(el.dataset.rotate)+'deg)';
      el.style.borderStyle = bs || d.bs;
      el.style.borderWidth = (bw!=null? bw : d.bw) + 'px';
      el.style.borderColor = bc || d.bc;
      if(type==='triangle' || type==='star'){ el.style.border = '0'; }
      var shape = document.createElement('div');
      shape.className = 'shape ' + (type==='rect'?'rect': type==='circle'?'circle': type==='triangle'?'triangle': type==='star'?'star':'rect');
      el.appendChild(shape);
      var label = document.createElement('div'); label.className = 'label';
      var inner = document.createElement('div'); inner.className = 'label-inner';
      inner.innerText = text || defaultText(type);
      inner.style.color = fg || d.fg;
      inner.style.fontSize = (fontSize? fontSize : 14) + 'px';
      label.appendChild(inner);
      el.appendChild(label);
      setNodeBackground(el, (bg||d.bg), (bgAlpha!=null? bgAlpha : d.alpha));
      var hResize = document.createElement('div'); hResize.className = 'handle resize'; el.appendChild(hResize);
      var hRotate = document.createElement('div'); hRotate.className = 'handle rotate'; el.appendChild(hRotate);
      enableNodeInteractions(el);
      enableResize(el, hResize);
      enableRotate(el, hRotate);
      el.addEventListener('dblclick', function(e){
        if(el.dataset.type==='line') return;
        var lab = el.querySelector('.label-inner'); if(!lab) return;
        lab.contentEditable = 'true'; lab.classList.add('editing');
        placeCaretAtEnd(lab);
        var before = lab.innerText; var cancelled = false;
        function finish(commit){ lab.contentEditable = 'false'; lab.classList.remove('editing'); lab.removeEventListener('keydown', onKey); lab.removeEventListener('blur', onBlur); el.focus(); if(commit && lab.innerText !== before){ pushHistory(); } if(!commit){ lab.innerText = before; } }
        function onKey(ev){ if((ev.key==='Enter') && (ev.ctrlKey||ev.metaKey)){ ev.preventDefault(); finish(true); } else if(ev.key==='Escape'){ ev.preventDefault(); cancelled = true; finish(false); } }
        function onBlur(){ if(!cancelled){ finish(true); } }
        lab.addEventListener('keydown', onKey); lab.addEventListener('blur', onBlur);
        e.stopPropagation();
      });
      stage.appendChild(el);
      applyTextOrientation(el);
      return el;
    }

    function addNode(opts){
      if(opts.type==='line') return createLineNode(opts);
      return createShapeNode(opts);
    }

    function enableNodeInteractions(el){
      el.addEventListener('dragstart', e => e.preventDefault());
      function onPointerDown(e){
        if(connectMode){
          e.preventDefault(); e.stopPropagation();
          handleConnectClick(el);
          return;
        }

        var isHandle = e.target.classList && e.target.classList.contains('handle');
        var isEditing = e.target.classList && e.target.classList.contains('editing');
        if(isHandle || isEditing) return;
        if(!e.shiftKey) clearSelection();
        selectNode(el); e.stopPropagation(); updateInspectorFromSelection();
        if(e.altKey){ var clone = cloneNodePreserveSize(el); stage.appendChild(clone); startDrag(clone, e, function(){ pushHistory(); updateAllConnectors(); }); e.preventDefault(); }
        else{ startDrag(el, e, function(){ pushHistory(); updateAllConnectors(); }); }
      }
      el.addEventListener('pointerdown', onPointerDown);
      var lab = el.querySelector('.label'); if(lab) lab.addEventListener('pointerdown', onPointerDown);
      var inner = el.querySelector('.label-inner'); if(inner) inner.addEventListener('pointerdown', onPointerDown);
      var shape = el.querySelector('.shape'); if(shape) shape.addEventListener('pointerdown', onPointerDown);
    }

    function enableLineInteractions(el){
      el.addEventListener('dragstart', e => e.preventDefault());
      function beginDragBody(e){
        if(connectMode){ handleConnectClick(el); return; }
        if(e.target.classList && e.target.classList.contains('endpoint')) return;
        if(!e.shiftKey) clearSelection();
        selectNode(el); updateInspectorFromSelection();
        startDrag(el, e, function(){ pushHistory(); updateAllConnectors(); });
      }
      el.addEventListener('pointerdown', beginDragBody);
      function dragEndpoint(ep){
        ep.addEventListener('pointerdown', function(e){
          e.preventDefault(); e.stopPropagation();
          if(!el.classList.contains('selected')){ clearSelection(); selectNode(el); updateInspectorFromSelection(); }
          var grid = +gridRange.value; var snap = snapBox.checked;
          var start = clientToStage(e.clientX, e.clientY);
          var is1 = ep.classList.contains('ep1');
          var sx1 = +el.dataset.x1, sy1 = +el.dataset.y1;
          var sx2 = +el.dataset.x2, sy2 = +el.dataset.y2;
          function onMove(ev){
            var p = clientToStage(ev.clientX, ev.clientY);
            var dx = p.x - start.x, dy = p.y - start.y;
            var nx = (is1? sx1 : sx2) + dx;
            var ny = (is1? sy1 : sy2) + dy;
            if(snap){ var g=+gridRange.value; nx = Math.round(nx/g)*g; ny = Math.round(ny/g)*g; }
            if(is1){ el.dataset.x1 = nx; el.dataset.y1 = ny; } else { el.dataset.x2 = nx; el.dataset.y2 = ny; }
            normalizeLineBBox(el);
            updateLineGraphics(el);
            updateAllConnectors();
          }
          function onUp(){ window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); pushHistory(); }
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
        });
      }
      dragEndpoint(el.querySelector('.ep1'));
      dragEndpoint(el.querySelector('.ep2'));
    }

    function normalizeLineBBox(el){
      var x1=+el.dataset.x1||0, y1=+el.dataset.y1||0, x2=+el.dataset.x2||0, y2=+el.dataset.y2||0;
      var minX = Math.min(x1,x2), minY = Math.min(y1,y2);
      var maxX = Math.max(x1,x2), maxY = Math.max(y1,y2);
      var left = parseInt(el.style.left,10)||0;
      var top  = parseInt(el.style.top,10)||0;
      el.style.left = (left + minX) + 'px';
      el.style.top  = (top  + minY) + 'px';
      var nx1 = x1 - minX, ny1 = y1 - minY, nx2 = x2 - minX, ny2 = y2 - minY;
      el.dataset.x1 = nx1; el.dataset.y1 = ny1; el.dataset.x2 = nx2; el.dataset.y2 = ny2;
      el.style.width  = (maxX - minX || 1) + 'px';
      el.style.height = (maxY - minY || 1) + 'px';
    }

    function updateLineGraphics(el){
      var svg = el.querySelector('.line-svg'); var ln = svg && svg.querySelector('line');
      var x1=+el.dataset.x1||0, y1=+el.dataset.y1||0, x2=+el.dataset.x2||0, y2=+el.dataset.y2||0;
      var w = parseInt(el.style.width,10)||1, h=parseInt(el.style.height,10)||1;
      svg.setAttribute('viewBox', '0 0 '+w+' '+h);
      svg.setAttribute('width', w); svg.setAttribute('height', h);
      ln.setAttribute('x1', x1); ln.setAttribute('y1', y1); ln.setAttribute('x2', x2); ln.setAttribute('y2', y2);
      ln.setAttribute('stroke', el.dataset.color || '#64748b');
      ln.setAttribute('stroke-width', +el.dataset.strokeW || 2);
      var ep1 = el.querySelector('.ep1'); var ep2 = el.querySelector('.ep2');
      ep1.style.left = x1+'px'; ep1.style.top = y1+'px';
      ep2.style.left = x2+'px'; ep2.style.top = y2+'px';
    }

    function placeCaretAtEnd(el){ var range = document.createRange(); range.selectNodeContents(el); range.collapse(false); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); }

    function defaultText(type){
      if(type==='rect') return '四角形';
      if(type==='circle') return '円形';
      if(type==='triangle') return '三角形';
      if(type==='star') return '星形';
      if(type==='line') return '';
      if(type==='desk') return '机';
      if(type==='chair') return '椅子';
      if(type==='pc') return 'PC';
      if(type==='label') return 'ラベル';
      if(type==='phone') return '電話';
      return type;
    }

    function cloneNodePreserveSize(el){
      if(el.dataset.type==='line'){
        return addNode({
          type:'line',
          x: parseInt(el.style.left,10)+10,
          y: parseInt(el.style.top,10)+10,
          x1: +el.dataset.x1, y1:+el.dataset.y1, x2:+el.dataset.x2, y2:+el.dataset.y2,
          strokeW: +el.dataset.strokeW, color: el.dataset.color
        });
      }
      var lab = el.querySelector('.label-inner');
      return addNode({
        type: el.dataset.type,
        x: parseInt(el.style.left,10)+10,
        y: parseInt(el.style.top,10)+10,
        w: parseInt(el.style.width,10),
        h: parseInt(el.style.height,10),
        text: lab? lab.innerText : '',
        bg: el.dataset.bgBase || '#ffffff',
        fg: lab? lab.style.color : '#111111',
        radius: parseInt(el.style.borderRadius,10)||8,
        rotate: parseFloat(el.dataset.rotate)||0,
        fontSize: parseInt(lab? lab.style.fontSize : '14',10),
        textMode: el.dataset.textMode || 'auto',
        borderW: parseInt(el.style.borderWidth,10)||1,
        borderS: el.style.borderStyle || 'solid',
        borderC: el.style.borderColor || '#cbd5e1',
        bgAlpha: (el.dataset.bgAlpha!=null? +el.dataset.bgAlpha : 1)
      });
    }

    /* ===== 選択管理（ノード＋コネクタ） ===== */
    function selectedNodes(){ return $$('.node.selected', stage); }
    function selectedConnectors(){ return connections.filter(function(c){ var el = $('#'+CSS.escape(c.id)); return el && el.classList.contains('selected'); }); }
    function clearConnectorSelection(){ connections.forEach(function(c){ var el = $('#'+CSS.escape(c.id)); if(el) el.classList.remove('selected'); }); }
    function selectConnector(el){ el.classList.add('selected'); }
    function selectNode(el){
      el.classList.add('selected');
      // 必要に応じて el.focus(); を追加
    }
    function clearSelection(){ selectedNodes().forEach(function(n){ n.classList.remove('selected'); }); clearConnectorSelection(); }

    stage.addEventListener('pointerdown', function(e){
      if(e.target === stage){
        clearSelection();
        startMarquee(e);
        updateInspectorFromSelection();
      }
    });

    connLayer.addEventListener('click', function(e){
      var target = e.target;
      if(target && target.classList.contains('connector')){
        if(!e.shiftKey){ clearSelection(); }
        selectConnector(target);
        updateInspectorFromSelection();
        e.stopPropagation();
      }
    });

    /* ===== キーボード ===== */
    document.addEventListener('keydown', function(e){
      var tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      var contentEditable = (e.target && e.target.isContentEditable);
      var typing = tag==='input' || tag==='textarea' || contentEditable;
      if(e.key==='Delete' && !typing){ e.preventDefault(); deleteSelected(); pushHistory(); return; }
      if((e.ctrlKey||e.metaKey) && !typing){
        var k = e.key.toLowerCase();
        if(k==='a'){ e.preventDefault(); $$('.node', stage).forEach(function(n){ n.classList.add('selected'); }); connections.forEach(function(c){ var el=$('#'+CSS.escape(c.id)); if(el) el.classList.add('selected'); }); updateInspectorFromSelection(); }
        if(k==='c'){ e.preventDefault(); copySelection(); }
        if(k==='x'){ e.preventDefault(); cutSelection(); pushHistory(); }
        if(k==='v'){ e.preventDefault(); pasteSelection(); pushHistory(); }
        if(k==='z'){ e.preventDefault(); if(e.shiftKey){ redo(); } else { undo(); } }
        if(k==='y'){ e.preventDefault(); redo(); }
      }
    });

    // ボタン
    $('#btnCopy').addEventListener('click', function(){ copySelection(); });
    $('#btnCut').addEventListener('click', function(){ cutSelection(); pushHistory(); });
    $('#btnPaste').addEventListener('click', function(){ pasteSelection(); pushHistory(); });
    $('#btnDelete').addEventListener('click', function(){ deleteSelected(); pushHistory(); });

    /* ===== クリップボード（ノードのみ） ===== */
    var clipData = null;
    var pasteBump = 0;
    function copySelection(){ var sel = selectedNodes(); if(sel.length===0) return; clipData = sel.map(function(n){ return nodeToData(n); }); pasteBump = 0; }
    function cutSelection(){ var sel = selectedNodes(); if(sel.length===0) return; clipData = sel.map(function(n){ return nodeToData(n); }); pasteBump = 0; sel.forEach(function(n){ removeNodeAndConnections(n); }); }
    function pasteSelection(){
      if(!clipData) return;
      pasteBump += 20;
      clearSelection();
      (clipData.nodes? clipData.nodes : clipData).forEach(function(d){
        var el = addNode(d);
        el.style.left = (parseInt(el.style.left,10)+pasteBump)+'px';
        el.style.top  = (parseInt(el.style.top,10)+pasteBump)+'px';
        el.classList.add('selected');
      });
      updateInspectorFromSelection(); updateAllConnectors();
    }

    function nodeToData(n){
      if(n.dataset.type==='line'){
        return {
          type:'line',
          x: parseInt(n.style.left,10)||0,
          y: parseInt(n.style.top,10)||0,
          x1:+n.dataset.x1||0, y1:+n.dataset.y1||0, x2:+n.dataset.x2||0, y2:+n.dataset.y2||0,
          strokeW:+n.dataset.strokeW||2, color:n.dataset.color||'#64748b'
        };
      }
      var lab = n.querySelector('.label-inner');
      return {
        type: n.dataset.type,
        x: parseInt(n.style.left,10)||0,
        y: parseInt(n.style.top,10)||0,
        w: parseInt(n.style.width,10)||n.clientWidth,
        h: parseInt(n.style.height,10)||n.clientHeight,
        text: lab? (lab.innerText||'') : '',
        bg: n.dataset.bgBase || '#ffffff',
        fg: lab? (lab.style.color || '') : '',
        radius: parseInt(n.style.borderRadius,10)||8,
        rotate: parseFloat(n.dataset.rotate)||0,
        fontSize: parseInt(lab? (lab.style.fontSize||'14') : '14',10),
        textMode: n.dataset.textMode || 'auto',
        borderW: parseInt(n.style.borderWidth,10)||1,
        borderS: n.style.borderStyle || 'solid',
        borderC: n.style.borderColor || '#cbd5e1',
        bgAlpha: (n.dataset.bgAlpha!=null? +n.dataset.bgAlpha : 1)
      };
    }

    /* ===== 座標変換・ドラッグ・サイズ変更 ===== */
    function clientToStage(clientX, clientY){ var r = stageWrap.getBoundingClientRect(); return { x: (clientX - r.left)/zoom, y: (clientY - r.top)/zoom }; }

    function startDrag(el, e, onEnd){
      if(e.preventDefault) e.preventDefault();
      var cx = (e.clientX!=null)? e.clientX : (e.touches && e.touches[0].clientX);
      var cy = (e.clientY!=null)? e.clientY : (e.touches && e.touches[0].clientY);
      var p0 = clientToStage(cx, cy);
      var elL = parseInt(el.style.left,10)||0;
      var elT = parseInt(el.style.top,10)||0;
      var offsetX = p0.x - elL;
      var offsetY = p0.y - elT;
      var grid = +gridRange.value;
      var snap = snapBox.checked;

      function onMove(ev){
        var mx = (ev.clientX!=null)? ev.clientX : (ev.touches && ev.touches[0].clientX);
        var my = (ev.clientY!=null)? ev.clientY : (ev.touches && ev.touches[0].clientY);
        var p = clientToStage(mx, my);
        var x = p.x - offsetX;
        var y = p.y - offsetY;
        if(snap){ x = Math.round(x/grid)*grid; y = Math.round(y/grid)*grid; }
        el.style.left = clamp(x,0,stage.clientWidth - (el.clientWidth||1)) + 'px';
        el.style.top  = clamp(y,0,stage.clientHeight - (el.clientHeight||1)) + 'px';
      }
      function onUp(){
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', onUp);
        if(typeof onEnd==='function') onEnd();
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('touchmove', onMove, {passive:false});
      window.addEventListener('touchend', onUp);
    }

    function enableResize(el, handle){
      handle.addEventListener('pointerdown', function(e){
        e.preventDefault(); e.stopPropagation();
        var startX = e.clientX, startY = e.clientY;
        var startW = parseInt(el.style.width,10);
        var startH = parseInt(el.style.height,10);
        var grid = +gridRange.value; var snap = snapBox.checked;
        function onMove(ev){
          var dx = (ev.clientX - startX)/zoom;
          var dy = (ev.clientY - startY)/zoom;
          var w = startW + dx, h = startH + dy;
          w = Math.max(10, w);
          h = Math.max(6, h);
          if(snap){ w = Math.max(grid, Math.round(w/grid)*grid); h = Math.max(grid, Math.round(h/grid)*grid); }
          el.style.width = w+'px'; el.style.height = h+'px';
          updateAllConnectors();
        }
        function onUp(){ window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); pushHistory(); updateAllConnectors(); }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    }

    function enableRotate(el, handle){
      var dragging = false;
      handle.addEventListener('pointerdown', function(e){ e.preventDefault(); e.stopPropagation(); dragging = true; handle.style.cursor = 'grabbing'; });
      window.addEventListener('pointermove', function(e){
        if(!dragging) return;
        var er = el.getBoundingClientRect();
        var cx = er.left + er.width/2;
        var cy = er.top  + er.height/2;
        var dx = e.clientX - cx;
        var dy = e.clientY - cy;
        var deg = Math.round((Math.atan2(dy, dx) * 180/Math.PI) + 90);
        var snap5 = Math.round(deg / 5) * 5;
        el.dataset.rotate = snap5;
        el.style.transform = 'rotate('+snap5+'deg)';
        applyTextOrientation(el);
        updateInspectorFromSelection();
        updateAllConnectors();
      });
      window.addEventListener('pointerup', function(){ if(dragging){ dragging = false; handle.style.cursor = 'grab'; pushHistory(); updateAllConnectors(); } });
    }

    /* ===== テキスト向き ===== */
    function applyTextOrientation(el){
      if(el.dataset.type==='line') return;
      var lab = el.querySelector('.label');
      var mode = el.dataset.textMode || 'auto';
      var deg = parseFloat(el.dataset.rotate)||0;
      if(mode==='v'){ lab.style.writingMode = 'vertical-rl'; lab.style.transform = ''; }
      else if(mode==='h'){ lab.style.writingMode = ''; lab.style.transform = ''; }
      else{ lab.style.writingMode = ''; lab.style.transform = 'rotate('+(-deg)+'deg)'; }
    }

    /* ===== 範囲選択 ===== */
    function startMarquee(e){
      var o = clientToStage(e.clientX, e.clientY); var ox = o.x, oy = o.y;
      marquee.style.display = 'block'; setMarquee(ox, oy, 0, 0);
      function onMove(ev){
        var p = clientToStage(ev.clientX, ev.clientY);
        var x = Math.min(ox, p.x), y = Math.min(oy, p.y);
        var w = Math.abs(p.x - ox), h = Math.abs(p.y - oy);
        setMarquee(x, y, w, h);
        var mx = x, my = y, mw = w, mh = h;
        $$('.node', stage).forEach(function(n){
          var nx = parseInt(n.style.left,10), ny = parseInt(n.style.top,10);
          var nw = parseInt(n.style.width,10), nh = parseInt(n.style.height,10);
          var hit = !(nx>mx+mw || nx+nw<mx || ny>my+mh || ny+nh<my);
          n.classList.toggle('selected', hit);
        });
        clearConnectorSelection(); // 今はドラッグでコネクタ複数選択はなし（必要なら後で矩形交差計算）
        updateInspectorFromSelection();
      }
      function onUp(){ marquee.style.display = 'none'; window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); pushHistory(); }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    }
    function setMarquee(x,y,w,h){ marquee.style.left = x+'px'; marquee.style.top = y+'px'; marquee.style.width = w+'px'; marquee.style.height= h+'px'; }

    /* ===== エクスポート/インポート/新規 ===== */
    $('#btnExport').addEventListener('click', function(){
      var blob = new Blob([JSON.stringify(serialize(), null, 2)], {type:'application/json'});
      var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = url; a.download = 'layout-board.json';
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    });
    var dlg = $('#dlgImport'); var fileInput = $('#importFile');
    $('#btnImport').addEventListener('click', function(){ fileInput.value=''; dlg.showModal(); });
    $('#importCancel').addEventListener('click', function(){ dlg.close(); });
    $('#importDo').addEventListener('click', function(){
      var f = fileInput.files && fileInput.files[0];
      if(!f){ alert('JSONファイルを選択してください'); return; }
      var reader = new FileReader();
      reader.onload = function(){
        try{
          var data = JSON.parse(reader.result);
          loadFrom(data);
          dlg.close(); setZoom(1); resetHistory();
        }catch(err){ console.error(err); alert('JSONの読み込みに失敗しました'); }
      };
      reader.readAsText(f, 'utf-8');
    });
    $('#btnNew').addEventListener('click', function(){ if(confirm('キャンバスをクリアします。よろしいですか？')){ loadFrom([]); setZoom(1); resetHistory(); } });

    /* ===== 画像保存（コネクタ矢印対応・テキスト位置補正） ===== */
    var dlgImage = $('#dlgImage');
    $('#btnExportImage').addEventListener('click', function(){ dlgImage.showModal(); });
    $('#imgCancel').addEventListener('click', function(){ dlgImage.close(); });
    $('#savePNG').addEventListener('click', function(){ saveAsImage('png'); });
    $('#saveJPEG').addEventListener('click', function(){ saveAsImage('jpeg'); });

    function saveAsImage(kind){
      var W = stage.clientWidth, H = stage.clientHeight;
      var canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = getComputedStyle(stage).backgroundColor || '#ffffff'; ctx.fillRect(0,0,W,H);

      if($('#gridToggle').checked){
        var g = +gridRange.value; ctx.strokeStyle = '#f1f5f9'; ctx.lineWidth = 1; ctx.beginPath();
        for(var x=0; x<=W; x+=g){ ctx.moveTo(x+0.5,0); ctx.lineTo(x+0.5,H); }
        for(var y=0; y<=H; y+=g){ ctx.moveTo(0,y+0.5); ctx.lineTo(W,y+0.5); }
        ctx.stroke();
      }

      // コネクタ（矢印対応）
      connections.forEach(function(c){
        var a = getAnchorPoint($('#'+CSS.escape(c.from)), c.fa==='auto'? chooseAnchor($('#'+CSS.escape(c.from)),$('#'+CSS.escape(c.to))) : c.fa);
        var b = getAnchorPoint($('#'+CSS.escape(c.to)),   c.ta==='auto'? chooseAnchor($('#'+CSS.escape(c.to)),$('#'+CSS.escape(c.from))) : c.ta);
        ctx.save();
        ctx.beginPath(); ctx.lineWidth = c.stroke || 2; ctx.strokeStyle = c.color || '#64748b'; ctx.fillStyle = c.color || '#64748b';
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        // 矢印
        if(c.arrowEnd){ drawArrowhead(ctx, a, b, (c.stroke||2)*3 + 6); }
        if(c.arrowStart){ drawArrowhead(ctx, b, a, (c.stroke||2)*3 + 6); }
        ctx.restore();
      });

      // ノード
      $$('.node', stage).forEach(function(n){
        var type = n.dataset.type;
        if(type==='line'){
          var p1 = lineAbsPoint(n, +n.dataset.x1, +n.dataset.y1);
          var p2 = lineAbsPoint(n, +n.dataset.x2, +n.dataset.y2);
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.lineWidth = +n.dataset.strokeW || 2;
          ctx.strokeStyle = n.dataset.color || '#64748b';
          ctx.stroke();
          ctx.restore();
          return;
        }

        var lab = n.querySelector('.label-inner');
        var x = parseInt(n.style.left,10)||0, y = parseInt(n.style.top,10)||0;
        var w = parseInt(n.style.width,10)||n.clientWidth, h = parseInt(n.style.height,10)||n.clientHeight;
        var r = parseInt(n.style.borderRadius,10)||8;
        var baseHex = n.dataset.bgBase || '#ffffff';
        var alpha = (n.dataset.bgAlpha!=null? +n.dataset.bgAlpha : 1);
        var fg = lab ? (lab.style.color || '#111111') : '#111111';
        var fs = parseInt(lab ? (lab.style.fontSize||'14') : '14',10);
        var deg = parseFloat(n.dataset.rotate)||0;
        var mode = n.dataset.textMode || 'auto';
        var text = lab ? (lab.innerText||'') : '';
        var bw = parseInt(n.style.borderWidth,10)||1;
        var bs = n.style.borderStyle || 'solid';
        var bc = n.style.borderColor || '#cbd5e1';

        ctx.save();
        ctx.translate(x + w/2, y + h/2);
        ctx.rotate(deg * Math.PI/180);
        roundRect(ctx, -w/2, -h/2, w, h, Math.min(r, Math.min(w,h)/2));
        ctx.fillStyle = makeRgba(baseHex, alpha); ctx.fill();
        if(!(bs==='none' || bw<=0)){
          ctx.lineWidth = bw; ctx.strokeStyle = bc;
          if(bs==='dashed'){ ctx.setLineDash([6,4]); }
          else if(bs==='dotted'){ ctx.setLineDash([1,3]); }
          else { ctx.setLineDash([]); }
          ctx.stroke();
        }

        var padX = 8, padY = 6;
        var cw = w - padX*2;
        var ch = h - padY*2;
        ctx.fillStyle = fg;
        ctx.font = fs+'px system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans JP"';
        var textAlign = getComputedStyle(lab).textAlign || 'center';
        var alignH = getComputedStyle(n.querySelector('.label')).justifyContent || 'center';
        var alignV = getComputedStyle(n.querySelector('.label')).alignItems || 'center';
        var ox = 0, oy = 0;
        if(alignH==='flex-start') ox = -w/2 + padX;
        else if(alignH==='center') ox = 0;
        else if(alignH==='flex-end') ox =  w/2 - padX;
        if(alignV==='flex-start') oy = -h/2 + padY;
        else if(alignV==='center') oy = 0;
        else if(alignV==='flex-end') oy =  h/2 - padY;

        var draw = function(){ wrapTextCanvas(ctx, text, ox, oy, cw, ch, fs, textAlign); };
        if(mode==='auto'){ ctx.save(); ctx.rotate(-deg * Math.PI/180); draw(); ctx.restore(); } else { draw(); }
        ctx.restore();
      });

      var q = parseFloat($('#jpegQ').value)||0.9;
      var mime = (kind==='jpeg') ? 'image/jpeg' : 'image/png';
      var data = canvas.toDataURL(mime, (kind==='jpeg') ? q : undefined);
      var a = document.createElement('a'); a.href = data; a.download = (kind==='jpeg'?'layout-board.jpg':'layout-board.png');
      document.body.appendChild(a); a.click(); a.remove(); dlgImage.close();
    }

    function drawArrowhead(ctx, from, to, size){
      var angle = Math.atan2(to.y - from.y, to.x - from.x);
      var s = Math.max(6, size||10);
      ctx.beginPath();
      ctx.moveTo(to.x, to.y);
      ctx.lineTo(to.x - s * Math.cos(angle - Math.PI/6), to.y - s * Math.sin(angle - Math.PI/6));
      ctx.lineTo(to.x - s * Math.cos(angle + Math.PI/6), to.y - s * Math.sin(angle + Math.PI/6));
      ctx.closePath();
      ctx.fill();
    }

    function lineAbsPoint(el, lx, ly){
      return { x:(parseInt(el.style.left,10)||0) + lx, y:(parseInt(el.style.top,10)||0) + ly };
    }

    function wrapTextCanvas(ctx, text, ox, oy, cw, ch, fs, textAlign){
      var lh = fs * 1.3;
      var lines = [];
      String(text).split('\n').forEach(function(par){
        var tokens = par.split(/(\s+)/);
        var line = '';
        tokens.forEach(function(t){
          var test = line + t;
          if(ctx.measureText(test).width > cw && line){
            lines.push(line);
            line = t.trimStart();
          }else{
            line = test;
          }
        });
        lines.push(line);
      });
      var totalH = lines.length * lh;
      var sy = oy - totalH/2 + lh/2;
      ctx.textBaseline = 'middle';
      ctx.textAlign = (textAlign==='left'?'left': textAlign==='right'?'right':'center');
      lines.forEach(function(L){
        var tx = ox;
        if(textAlign==='left') tx = ox - (cw/2);
        else if(textAlign==='right') tx = ox + (cw/2);
        ctx.fillText(L, tx, sy);
        sy += lh;
      });
    }

    function roundRect(ctx, x, y, w, h, r){ r = Math.min(r, w/2, h/2); ctx.beginPath(); ctx.moveTo(x+r, y); ctx.lineTo(x+w-r, y); ctx.quadraticCurveTo(x+w, y, x+w, y+r); ctx.lineTo(x+w, y+h-r); ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h); ctx.lineTo(x+r, y+h); ctx.quadraticCurveTo(x, y+h, x, y+h-r); ctx.lineTo(x, y+r); ctx.quadraticCurveTo(x, y, x+r, y); ctx.closePath(); }

    /* ===== 重なり順ボタン ===== */
    $('#zFrontMost').addEventListener('click', function(){ var sel = selectedNodes(); var order = Array.prototype.slice.call(stage.children); sel.sort(function(a,b){ return order.indexOf(a)-order.indexOf(b); }).forEach(function(n){ stage.appendChild(n); }); pushHistory(); });
    $('#zBackMost').addEventListener('click', function(){ var sel = selectedNodes(); var order = Array.prototype.slice.call(stage.children); sel.sort(function(a,b){ return order.indexOf(a)-order.indexOf(b); }); for(var i=sel.length-1;i>=0;i--){ stage.insertBefore(sel[i], stage.firstChild); } pushHistory(); });
    $('#zFront').addEventListener('click', function(){ var all = Array.prototype.slice.call(stage.children); var selSet = new Set(selectedNodes()); for(var i=all.length-1;i>=0;i--){ var n = all[i]; if(!selSet.has(n)) continue; var next = n.nextElementSibling; while(next && selSet.has(next)) next = next.nextElementSibling; if(next){ stage.insertBefore(n, next.nextElementSibling); } else { stage.appendChild(n); } } pushHistory(); });
    $('#zBack').addEventListener('click', function(){ var all = Array.prototype.slice.call(stage.children); var selSet = new Set(selectedNodes()); for(var i=0;i<all.length;i++){ var n = all[i]; if(!selSet.has(n)) continue; var prev = n.previousElementSibling; while(prev && selSet.has(prev)) prev = prev.previousElementSibling; if(prev){ stage.insertBefore(n, prev); } else { stage.insertBefore(n, stage.firstChild); } } pushHistory(); });

    /* ===== インスペクタ ===== */
    var ipBg = $('#bgColor'), ipFg = $('#fgColor'), ipFont = $('#fontSize'), ipRadius = $('#radius'), ipRotate = $('#rotateDeg'), ipTextMode = $('#textMode');
    var ipBW = $('#borderW'), ipBC = $('#borderC'), ipBS = $('#borderS'), ipAlpha = $('#bgAlpha');
    var ipAlignH = $('#alignH'), ipAlignV = $('#alignV');
    var ipLineThick = $('#lineThickness');
    var autoApply = $('#autoApply');

    var ipConnStroke = $('#connStroke'), ipConnColor = $('#connColor'), ipConnFrom = $('#connFrom'), ipConnTo = $('#connTo'), ipConnArrowStart = $('#connArrowStart'), ipConnArrowEnd = $('#connArrowEnd');

    function doApply(){
      var nodes = selectedNodes();
      var conns = selectedConnectors();
      // ノード適用
      nodes.forEach(function(n){
        if(n.dataset.type==='line'){
          if(ipLineThick.value){ n.dataset.strokeW = clamp(parseInt(ipLineThick.value,10)||2, 1, 200); updateLineGraphics(n); }
          return;
        }
        var lab = n.querySelector('.label'), inner = n.querySelector('.label-inner');
        if(ipBg.value){ setNodeBackground(n, ipBg.value, (+ipAlpha.value)/100); }
        if(ipFg.value && inner) inner.style.color = ipFg.value;
        if(ipFont.value && inner) inner.style.fontSize = parseInt(ipFont.value,10)+'px';
        if(ipRadius.value!=='') n.style.borderRadius = parseInt(ipRadius.value,10)+'px';
        if(ipRotate.value!==''){ var deg = parseFloat(ipRotate.value)||0; n.dataset.rotate = deg; n.style.transform = 'rotate('+deg+'deg)'; }
        if(ipTextMode.value){ n.dataset.textMode = ipTextMode.value; }
        if(ipBS.value==='none'){ n.style.border = '0'; } else { n.style.borderStyle = ipBS.value; n.style.borderWidth = clamp(parseInt(ipBW.value||'1',10),0,50)+'px'; n.style.borderColor = ipBC.value || '#cbd5e1'; }
        if(lab && inner){
          lab.style.justifyContent = (ipAlignH.value==='left'?'flex-start': ipAlignH.value==='right'?'flex-end':'center');
          inner.style.textAlign = (ipAlignH.value==='left'?'left': ipAlignH.value==='right'?'right':'center');
          lab.style.alignItems = (ipAlignV.value==='top'?'flex-start': ipAlignV.value==='bottom'?'flex-end':'center');
        }
        applyTextOrientation(n);
      });
      // コネクタ適用
      conns.forEach(function(c){
        c.stroke = clamp(parseInt(ipConnStroke.value||'2',10), 1, 50);
        c.color  = ipConnColor.value || '#64748b';
        c.fa = ipConnFrom.value || 'auto';
        c.ta = ipConnTo.value || 'auto';
        c.arrowStart = !!ipConnArrowStart.checked;
        c.arrowEnd   = !!ipConnArrowEnd.checked;
        updateConnection(c);
      });
      updateAllConnectors();
    }

    $('#applyStyle').addEventListener('click', function(){ doApply(); pushHistory(); });
    $('#resetStyle').addEventListener('click', function(){
      selectedNodes().forEach(function(n){
        if(n.dataset.type==='line'){ n.dataset.strokeW = typeDefaults.line.strokeW; updateLineGraphics(n); return; }
        var t = n.dataset.type; var d = typeDefaults[t]||{bg:'#fff',fg:'#111',radius:8,bw:1,bs:'solid',bc:'#cbd5e1',alpha:1};
        var lab = n.querySelector('.label'); var inner = n.querySelector('.label-inner');
        setNodeBackground(n, d.bg, d.alpha);
        if(inner){ inner.style.color = d.fg; inner.style.fontSize = '14px'; inner.innerText = defaultText(t); inner.style.textAlign = 'center'; }
        if(lab){ lab.style.justifyContent = 'center'; lab.style.alignItems = 'center'; }
        n.style.borderRadius = d.radius+'px'; n.dataset.rotate = 0; n.style.transform = 'rotate(0deg)';
        n.dataset.textMode = 'auto'; n.style.borderWidth = d.bw+'px'; n.style.borderStyle = d.bs; n.style.borderColor = d.bc;
        if(t==='triangle' || t==='star'){ n.style.border='0'; }
        applyTextOrientation(n);
      });
      selectedConnectors().forEach(function(c){
        c.stroke = 2; c.color = '#64748b'; c.fa='auto'; c.ta='auto'; c.arrowStart=false; c.arrowEnd=false; updateConnection(c);
      });
      updateInspectorFromSelection(); pushHistory(); updateAllConnectors();
    });

    // 自動適用
    var applyTimer = null;
    $('.inspector').addEventListener('input', onPanelChange, true);
    $('.inspector').addEventListener('change', onPanelChange, true);
    function onPanelChange(ev){
      if(!autoApply.checked) return;
      if(ev.target.id==='applyStyle' || ev.target.id==='resetStyle') return;
      clearTimeout(applyTimer);
      applyTimer = setTimeout(function(){ doApply(); pushHistory(); }, 60);
    }

    function updateInspectorFromSelection(){
      var selNodes = selectedNodes();
      var selConns = selectedConnectors();
      // 単一選択時に値を反映（コネクタ優先）
      if(selConns.length===1){
        var c = selConns[0];
        ipConnStroke.value = c.stroke || 2;
        ipConnColor.value = c.color || '#64748b';
        ipConnFrom.value = c.fa || 'auto';
        ipConnTo.value = c.ta || 'auto';
        ipConnArrowStart.checked = !!c.arrowStart;
        ipConnArrowEnd.checked = !!c.arrowEnd;
      }else if(selNodes.length===1){
        var n = selNodes[0];
        if(n.dataset.type==='line'){
          ipLineThick.disabled=false; ipLineThick.value = +n.dataset.strokeW || 2;
        }else{
          ipLineThick.disabled=true;
          var lab = n.querySelector('.label'), inner = n.querySelector('.label-inner');
          var base = n.dataset.bgBase || '#ffffff'; var alpha = (n.dataset.bgAlpha!=null? +n.dataset.bgAlpha : 1);
          ipBg.value = base; ipAlpha.value = Math.round(alpha*100);
          if(inner){ ipFg.value = rgb2hex(inner.style.color || getComputedStyle(inner).color) || '#111111'; ipFont.value = parseInt(inner.style.fontSize || getComputedStyle(inner).fontSize,10) || 14; }
          ipRadius.value = parseInt(n.style.borderRadius || getComputedStyle(n).borderRadius,10) || 8;
          ipRotate.value = parseFloat(n.dataset.rotate)||0; ipTextMode.value = n.dataset.textMode || 'auto';
          ipBW.value = parseInt(n.style.borderWidth || getComputedStyle(n).borderWidth,10) || 1;
          ipBS.value = (n.style.borderStyle || getComputedStyle(n).borderStyle) || 'solid';
          ipBC.value = rgb2hex(n.style.borderColor || getComputedStyle(n).borderColor) || '#cbd5e1';
          if(lab && inner){
            var jc = getComputedStyle(lab).justifyContent; $('#alignH').value = (jc==='flex-start'?'left': jc==='flex-end'?'right':'center');
            var ai = getComputedStyle(lab).alignItems; $('#alignV').value = (ai==='flex-start'?'top': ai==='flex-end'?'bottom':'center');
          }
        }
      }
    }
    function rgb2hex(rgb){ if(!rgb) return null; if(rgb.indexOf('#')===0) return rgb; var m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); if(!m) return '#ffffff'; var r=(+m[1]).toString(16); if(r.length<2) r='0'+r; var g=(+m[2]).toString(16); if(g.length<2) g='0'+g; var b=(+m[3]).toString(16); if(b.length<2) b='0'+b; return '#'+r+g+b; }

    /* ===== 削除 ===== */
    function deleteSelected(){
      // ノード
      selectedNodes().forEach(function(n){ removeNodeAndConnections(n); });
      // コネクタ
      selectedConnectors().forEach(function(c){
        var line = $('#'+CSS.escape(c.id)); if(line) line.remove();
        connections = connections.filter(function(x){ return x.id!==c.id; });
      });
      updateInspectorFromSelection();
      updateAllConnectors();
    }
    function removeNodeAndConnections(n){
      var id = n.dataset.id;
      connections.slice().forEach(function(c){
        if(c.from===id || c.to===id){
          var line = $('#'+CSS.escape(c.id)); if(line) line.remove();
          connections = connections.filter(function(x){ return x.id!==c.id; });
        }
      });
      n.remove();
    }

    /* ===== キャンバスをグリッドに揃える ===== */
    function normalizeCanvasToGrid(){
      var g = +gridRange.value;
      if(!stage.style.width || !stage.style.height){
        var cw = Math.round(parseFloat(getComputedStyle(stage).width));
        var ch = Math.round(parseFloat(getComputedStyle(stage).height));
        stage.style.width = cw+'px'; stage.style.height = ch+'px';
      }
      var w = parseInt(stage.style.width,10); var h = parseInt(stage.style.height,10);
      var nw = Math.max(g, Math.round(w / g) * g); var nh = Math.max(g, Math.round(h / g) * g);
      if(nw!==w) stage.style.width = nw+'px'; if(nh!==h) stage.style.height = nh+'px';
      updateConnLayerSize();
    }

    /* ===== 接続（図形と図形を線で結ぶ） ===== */
    var connectMode = false;
    var connectSource = null;
    var connections = []; // {id, from, to, fa, ta, stroke, color, arrowStart, arrowEnd}

    $('#btnConnect').addEventListener('click', function(){
      connectMode = !connectMode;
      $('#btnConnect').classList.toggle('btn-primary', connectMode);
      $('#connectHint').style.display = connectMode? 'inline' : 'none';
      connectSource = null;
    });

    function handleConnectClick(el){
      if(el.dataset.type==='line') return;
      if(!connectSource){
        connectSource = el;
        clearSelection(); selectNode(el);
      }else if(connectSource === el){
        connectSource = null; clearSelection();
      }else{
        var a1 = chooseAnchor(connectSource, el);
        var a2 = chooseAnchor(el, connectSource);
        var connId = 'c'+uid();
        var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('id', connId);
        line.setAttribute('class', 'connector');
        line.setAttribute('x1', '0'); line.setAttribute('y1', '0');
        line.setAttribute('x2', '0'); line.setAttribute('y2', '0');
        line.setAttribute('stroke', '#64748b'); line.setAttribute('stroke-width', '2');
        connLayer.appendChild(line);
        var c = {id:connId, from:connectSource.dataset.id, to:el.dataset.id, fa:'auto', ta:'auto', stroke:2, color:'#64748b', arrowStart:false, arrowEnd:false};
        connections.push(c);
        updateConnection(c);
        connectSource = null;
        clearSelection();
        pushHistory();
      }
    }

    function chooseAnchor(fromEl, toEl){
      var f = rectInfo(fromEl), t = rectInfo(toEl);
      var points = [
        {name:'left',  x:f.x,       y:f.y + f.h/2},
        {name:'right', x:f.x + f.w, y:f.y + f.h/2},
        {name:'top',   x:f.x + f.w/2, y:f.y},
        {name:'bottom',x:f.x + f.w/2, y:f.y + f.h}
      ];
      var target = {x: t.x + t.w/2, y: t.y + t.h/2};
      var best = points[0], bestD = dist(points[0], target);
      for(var i=1;i<points.length;i++){ var d = dist(points[i], target); if(d<bestD){ best=points[i]; bestD=d; } }
      return best.name;
    }

    function getAnchorPoint(el, name){
      var r = rectInfo(el);
      var cx = r.x + r.w/2, cy = r.y + r.h/2;
      var angle = parseFloat(el.dataset.rotate||'0') * Math.PI/180;
      var ax, ay;
      if(!name || name==='auto') name = 'right';
      if(name==='left'){ ax = r.x; ay = cy; }
      else if(name==='right'){ ax = r.x + r.w; ay = cy; }
      else if(name==='top'){ ax = cx; ay = r.y; }
      else if(name==='bottom'){ ax = cx; ay = r.y + r.h; }
      else { ax = r.x + r.w; ay = cy; }
      if(angle){
        var dx = ax - cx, dy = ay - cy;
        var rx = cx + dx*Math.cos(angle) - dy*Math.sin(angle);
        var ry = cy + dx*Math.sin(angle) + dy*Math.cos(angle);
        ax = rx; ay = ry;
      }
      return {x:ax, y:ay};
    }

    function rectInfo(el){
      var x = parseInt(el.style.left,10)||0;
      var y = parseInt(el.style.top,10)||0;
      var w = parseInt(el.style.width,10)||el.clientWidth||1;
      var h = parseInt(el.style.height,10)||el.clientHeight||1;
      return {x:x,y:y,w:w,h:h};
    }

    function dist(a,b){ var dx=a.x-b.x, dy=a.y-b.y; return Math.sqrt(dx*dx+dy*dy); }

    function updateConnection(c){
      var fromEl = $$('.node', stage).find(function(n){ return n.dataset.id===c.from; });
      var toEl   = $$('.node', stage).find(function(n){ return n.dataset.id===c.to; });
      if(!fromEl || !toEl){ return; }
      var fa = (c.fa && c.fa!=='auto') ? c.fa : chooseAnchor(fromEl, toEl);
      var ta = (c.ta && c.ta!=='auto') ? c.ta : chooseAnchor(toEl, fromEl);
      var a = getAnchorPoint(fromEl, fa);
      var b = getAnchorPoint(toEl, ta);
      var ln = $('#'+CSS.escape(c.id));
      if(!ln) return;
      ln.setAttribute('x1', a.x); ln.setAttribute('y1', a.y);
      ln.setAttribute('x2', b.x); ln.setAttribute('y2', b.y);
      ln.setAttribute('stroke-width', c.stroke||2);
      ln.setAttribute('stroke', c.color||'#64748b');
      ln.setAttribute('marker-start', c.arrowStart ? 'url(#arrowTail)' : '');
      ln.setAttribute('marker-end',   c.arrowEnd   ? 'url(#arrowHead)' : '');
    }
    function updateAllConnectors(){ connections.forEach(updateConnection); }

    /* ===== ロード系 ===== */
    function loadFrom(data){
      stage.querySelectorAll('.node').forEach(function(n){ n.remove(); });
      connLayer.querySelectorAll('.connector').forEach(function(n){ n.remove(); });
      connections = [];
      var nodes = Array.isArray(data) ? data : (data && data.nodes ? data.nodes : []);
      nodes.forEach(function(d){ if(d.bgAlpha==null) d.bgAlpha = 1; addNode(d); });
      var conns = Array.isArray(data) ? [] : (data && data.connections ? data.connections : []);
      conns.forEach(function(c){
        var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        var id = c.id || 'c'+uid();
        line.setAttribute('id', id);
        line.setAttribute('class','connector');
        connLayer.appendChild(line);
        connections.push({id:id, from:c.from, to:c.to, fa:c.fa||'auto', ta:c.ta||'auto', stroke:c.stroke||2, color:c.color||'#64748b', arrowStart:!!c.arrowStart, arrowEnd:!!c.arrowEnd});
      });
      updateAllConnectors();
    }

    /* ===== 初期ロード ===== */
    (function init(){
      applyGrid(+gridRange.value);
      normalizeCanvasToGrid();
      updateConnLayerSize();
      setZoom(1);
      resetHistory();
    })();

    /* ===== カラーユーティリティ ===== */
    function hexToRgb(hex){ if(!hex) return {r:255,g:255,b:255}; var h = hex.replace('#',''); if(h.length===3){ h = h.split('').map(function(c){return c+c;}).join(''); } return {r:parseInt(h.substr(0,2),16), g:parseInt(h.substr(2,2),16), b:parseInt(h.substr(4,2),16)}; }
    function makeRgba(hex, alpha){ var c = hexToRgb(hex||'#ffffff'); var a = (alpha==null?1:alpha); a = Math.max(0, Math.min(1, +a)); return 'rgba('+c.r+','+c.g+','+c.b+','+a+')'; }

  }catch(err){
    var bar = document.getElementById('errorbar');
    if(bar){ bar.style.display = 'block'; bar.textContent = '初期化エラー: ' + (err && err.message ? err.message : err); }
    console.error(err);
  }
})();
