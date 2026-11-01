/* 마법소녀 이벤트 화면 (마법소녀 테마가 켜져 있을 때만): 1차 묶음
   변신 팝업 · 1 변신 주문 · 2 코스튬 · 3 팀 · 4 정화의 노래 · 5 별자리 잇기
   판정은 서버(api/_magic.js)가 하고 이 파일은 그리기만 합니다.

   변신 팝업 연출 출처 (사용자가 준 '별빛 변신 팝업'을 옮김)
   참고: Lucian UX/UI Prompt #226, #229 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/
   Motion Prompt #003 · #015 · #023 · MIT License (c) 2026 Shohei Ohtaki · https://showheyohtaki.github.io/motion-prompt/
   맹세 주문 입력 팝업: 사용자가 준 두 번째 '별빛 변신 팝업'(하트 변신판) · Lucian UX/UI Prompt #226, #229 · MIT
   Motion Prompt kit "motion" (#001-024) · MIT License (c) 2026 Shohei Ohtaki · https://showheyohtaki.github.io/motion-prompt/#001 */
(function(){
"use strict";
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function btn(c,x,fn){var b=el("button",c,x);b.type="button";if(fn)b.addEventListener("click",fn);return b}
function call(m,u,b){return window.api?window.api(m,u,b):Promise.resolve({_status:0})}
function toast(t,ms){if(window.gwToast)window.gwToast(t,ms)}
function hms(ms){var s=Math.max(0,Math.ceil(ms/1000)),h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;return (h?h+":"+("0"+m).slice(-2):m)+":"+("0"+x).slice(-2)}
var RM=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function on(){return document.documentElement.classList.contains("mgl")}

/* ═════════ 코스튬 부품 이름 (도트 그림은 지웠고, 고른 부품을 글자로 보여 줍니다) ═════════ */
var COS_KO={r:{bow:"큰 나비 리본",star:"별 리본",heart:"하트 리본",cat:"고양이 귀 리본",crown:"작은 왕관"},s:{pants:"일자 바지",shorts:"반바지",cargo:"카고 바지",puff:"퍼프 치마",frill:"프릴 치마",bell:"종 치마",tulip:"튤립 치마",long:"긴 드레스"},
  c:{sakura:"벚꽃",sky:"하늘",lemon:"레몬",lavender:"라벤더",mint:"민트"},w:{star:"별",heart:"하트",moon:"초승달",gem:"보석",flower:"꽃"}};
var COS_COL={sakura:"#ff9cc6",sky:"#8cc8ff",lemon:"#ffd95e",lavender:"#b9a2ff",mint:"#7fe0c0"};
var PART_KO={r:"머리 장식",s:"하의 (바지·치마)",c:"색 테마",w:"지팡이 끝",e:"마법 의상"};
function partName(k,v){return (COS_KO[k]&&COS_KO[k][v])||v}
var EL_KO={fire:"화염",ice:"빙결",water:"물",lightning:"번개",earth:"대지",poison:"독",blast:"폭발",holy:"신성",arcane:"비전",shadow:"어둠"};
function cosText(c){c=c||{};return ["r","s","c","w"].filter(function(k){return c[k]}).map(function(k){return partName(k,c[k])+(k==="c"?" 테마":k==="w"?" 지팡이":"")}).concat(c.e&&EL_KO[c.e]?[EL_KO[c.e]+" 마법 의상"]:[]).join(" · ")}
function cosTag(c,cls){var t=el("span","mgs-costag"+(cls?" "+cls:""));t.style.setProperty("--cc",COS_COL[c&&c.c]||COS_COL.sakura);t.appendChild(el("i"));t.appendChild(document.createTextNode(cosText(c)||"기본 코스튬"));t.title="마법소녀 코스튬";return t}

/* ═════════ 변신 팝업 (별빛 변신 팝업을 옮김) ═════════ */
var TF=null;
function tfBuild(){
  if(TF)return TF;
  if(!document.getElementById("mgs-font")){var lk=document.createElement("link");lk.id="mgs-font";lk.rel="stylesheet";lk.href="https://fonts.googleapis.com/css2?family=Jua&family=Gowun+Dodum&family=Noto+Sans+Runic&display=swap";document.head.appendChild(lk)}
  var bd=el("div","mgtf");bd.hidden=true;
  bd.innerHTML='<div class="mgtf-pop" role="dialog" aria-modal="true" aria-labelledby="mgtfTitle"><div class="mgtf-grid" aria-hidden="true"></div><div class="mgtf-hot" aria-hidden="true"></div><canvas class="mgtf-bg" aria-hidden="true"></canvas><canvas class="mgtf-fx" aria-hidden="true"></canvas>'+
    '<div class="mgtf-head"><span class="mgtf-chip" aria-live="polite">STEP 1 · 마법진 소환</span><span class="mgtf-steps" aria-hidden="true"><i class="on"></i><i></i></span><button type="button" class="mgtf-x" aria-label="닫기"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button></div>'+
    '<p class="mgtf-top" hidden></p><p class="mgtf-chant" aria-hidden="true"></p>'+
    '<form class="mgtf-type" hidden autocomplete="off"><p class="mgtf-tq">마법소녀 이벤트가 시작됐어요.<br>아래 맹세 주문을 <b>직접 따라 적어야</b> 들어갈 수 있어요.</p><p class="mgtf-tg" aria-hidden="true"></p><label class="mgtf-sr" for="mgtfIn">맹세 주문 입력</label><input id="mgtfIn" class="mgtf-in" type="text" maxlength="40" spellcheck="false" autocapitalize="off" enterkeyhint="done"><p class="mgtf-tm" role="status"></p><div class="mgtf-tb"><button type="submit" class="go">✦ 영창</button><button type="button" class="out">로그아웃</button></div></form>'+
    '<div class="mgtf-foot"><h2 id="mgtfTitle" aria-label="별빛 변신 완료!"></h2><p class="mgtf-msg"></p><div class="mgtf-acts"><button type="button" class="go">✦ 다시 보기</button><button type="button" class="no">닫기</button></div></div><div class="mgtf-flash" aria-hidden="true"></div></div>';
  document.body.appendChild(bd);
  var pop=bd.querySelector(".mgtf-pop"),bgc=bd.querySelector(".mgtf-bg"),fxc=bd.querySelector(".mgtf-fx"),bg=bgc.getContext("2d"),fx=fxc.getContext("2d");
  var chip=bd.querySelector(".mgtf-chip"),flash=bd.querySelector(".mgtf-flash"),steps=bd.querySelectorAll(".mgtf-steps i"),chantEl=bd.querySelector(".mgtf-chant"),titleEl=bd.querySelector("#mgtfTitle");
  var TAU=Math.PI*2,C=32,WHITE="#FFFFFF",PASTEL="#FFD3E6",MID="#F58DBB",DEEP="#EE5B9C",COLS=[DEEP,MID,WHITE,PASTEL,DEEP,MID],STREAK="238,91,156";
  var RUNES=(function(){var set=Array.from("ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟᚴᛦᛯᛰᚻᛡ"),out=[],seed=7;function r(){seed=(seed*9301+49297)%233280;return seed/233280}for(var g=0;g<7;g++){var len=3+Math.floor(r()*4);for(var j=0;j<len;j++)out.push(set[Math.floor(r()*set.length)]);out.push("᛭")}return out})();
  var RUNE_FONT='"Noto Sans Runic","Segoe UI Historic","Segoe UI Symbol","Apple Symbols",sans-serif';
  var chantText="샤랄라 반짝, 별빛이여 모여라!",opener=null,V="moon",MODE="",typeP=0,autoT=0;
  var typeF=bd.querySelector(".mgtf-type"),typeIn=bd.querySelector(".mgtf-in"),typeTg=bd.querySelector(".mgtf-tg"),typeMsg=bd.querySelector(".mgtf-tm"),xBtn=bd.querySelector(".mgtf-x"),acts=bd.querySelector(".mgtf-acts");
  var actsOrig=Array.prototype.slice.call(acts.children);
  function letters(e,text,cls){e.innerHTML="";Array.from(text).forEach(function(ch,i){var s=document.createElement("span");if(cls)s.className=cls;s.style.setProperty("--i",i);s.textContent=ch===" "?"\u00a0":ch;if(cls)s.setAttribute("aria-hidden","true");e.appendChild(s)})}
  letters(titleEl,"별빛 변신 완료!","ltr");
  var W=380,H=580,dpr=Math.min(2,window.devicePixelRatio||1),cx=190,cy=230;
  function resize(){if(!pop.clientWidth)return;W=pop.clientWidth;H=pop.clientHeight;cx=W/2;cy=H*.4;[bgc,fxc].forEach(function(c){c.width=W*dpr;c.height=H*dpr});bg.setTransform(dpr,0,0,dpr,0,0);fx.setTransform(dpr,0,0,dpr,0,0)}
  function rnd(a,b){return a+Math.random()*(b-a)}function pick(a){return a[Math.floor(Math.random()*a.length)]}function clamp(v){return v<0?0:v>1?1:v}function ease(v){return 1-Math.pow(1-v,3)}
  function PP(v,a,b){return clamp((v-a)/(b-a))}function lerp(a,b,x){return a+(b-a)*x}function eIOs(x){return x<.5?2*x*x:1-Math.pow(-2*x+2,2)/2}function eOut5(x){return 1-Math.pow(1-x,5)}function smooth(x){return x*x*(3-2*x)}function mod(a,n){return((a%n)+n)%n}
  function spring(v,w,d){return v<=0?0:1-Math.exp(-d*v)*Math.cos(w*v)}function rand(seed){var s=seed>>>0;return function(){s=(s*1664525+1013904223)>>>0;return s/4294967296}}
  var CYC=4.7,BT0=.5,MOON=46;
  function star(c,x,y,r,rot){c.beginPath();for(var i=0;i<10;i++){var rr=i%2?r*.45:r,a=rot+i*Math.PI/5-Math.PI/2;c.lineTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr)}c.closePath();c.fill()}
  function heart(c,x,y,s,rot){c.save();c.translate(x,y);c.rotate(rot);c.scale(s/12,s/12);c.beginPath();c.moveTo(0,7);c.bezierCurveTo(-13,-1,-8,-13,0,-6);c.bezierCurveTo(8,-13,13,-1,0,7);c.closePath();c.fill();c.restore()}
  function sparkle(c,x,y,r,rot){c.save();c.translate(x,y);c.rotate(rot);c.beginPath();c.moveTo(0,-r);c.quadraticCurveTo(0,0,r,0);c.quadraticCurveTo(0,0,0,r);c.quadraticCurveTo(0,0,-r,0);c.quadraticCurveTo(0,0,0,-r);c.fill();c.restore()}
  function glowStroke(c,path,w,a){var ga=c.globalAlpha;c.globalAlpha=ga*.9*a;c.strokeStyle=PASTEL;c.shadowColor=MID;c.shadowBlur=12;c.lineWidth=w*3.4;path();c.stroke();c.globalAlpha=ga*a;c.strokeStyle=DEEP;c.shadowBlur=4;c.lineWidth=w*1.5;path();c.stroke();c.strokeStyle=WHITE;c.shadowBlur=0;c.lineWidth=w*.5;path();c.stroke();c.globalAlpha=ga}
  function moonPath(k,s){var R=s*.95,ox=R*.5,oy=-R*.3,r=R*.85,D=Math.hypot(ox,oy),th=Math.atan2(oy,ox);var al=Math.acos((R*R+D*D-r*r)/(2*R*D)),be=Math.acos((r*r+D*D-R*R)/(2*r*D));var sx=R*.2;k.beginPath();k.arc(sx,0,R,th+al,th-al+Math.PI*2,false);k.arc(sx+ox,oy,r,th+Math.PI+be,th+Math.PI-be,true);k.closePath()}
  function burstMoon(k,u,alpha){var X=cx,Y=cy+2,tt=u-BT0;var ant=eIOs(PP(u,.3,BT0));var sc=tt<0?1-.3*ant:.7+.3*spring(tt,16,6.5);
    if(tt>0&&tt<.75){var q=eOut5(tt/.6>1?1:tt/.6),fade=1-PP(tt,.3,.72);k.strokeStyle=MID;k.lineWidth=Math.max(.1,16*(1-q));k.beginPath();k.arc(X,Y,44+46*q,0,7);if(q<.98)k.stroke();k.lineCap="round";
      for(var i=0;i<10;i++){var a=i/10*Math.PI*2-Math.PI/2,r1=64+66*q,len=36*(1-PP(tt,.22,.7));if(len>.5){k.strokeStyle=i%2?PASTEL:MID;k.lineWidth=9;k.beginPath();k.moveTo(X+Math.cos(a)*(r1-len),Y+Math.sin(a)*(r1-len)*.82);k.lineTo(X+Math.cos(a)*r1,Y+Math.sin(a)*r1*.82);k.stroke()}
        var a2=a+Math.PI/10,r2=58+92*q;k.fillStyle=i%2?DEEP:MID;k.globalAlpha=fade;k.beginPath();k.arc(X+Math.cos(a2)*r2*1.45,Y+Math.sin(a2)*r2*.78,8*(1-q*.4),0,7);k.fill();k.globalAlpha=1}}
    k.save();k.globalAlpha=alpha;k.translate(X,Y-2);k.scale(sc,sc);moonPath(k,MOON);k.lineJoin="round";k.lineWidth=7;k.strokeStyle=DEEP;k.shadowColor=WHITE;k.shadowBlur=10;k.stroke();k.shadowBlur=0;
    if(tt>=0){k.fillStyle=DEEP;k.fill();k.stroke();k.fillStyle=WHITE;sparkle(k,-MOON*.55,-MOON*.2,7,0)}k.restore()}
  var PARTS=(function(){var R=rand(15),a=[],PAL=[DEEP,MID,PASTEL,WHITE];for(var i=0;i<84;i++){var n=R()<.5?2:3;a.push({T:CYC/n,ph:R()*CYC,vx:(R()-.5)*2*190,vy:-(250+R()*150),sz:5+R()*6,col:PAL[i%4],kind:i%3,spin:(R()-.5)*9})}return a})();
  function fountain(k,u){var X=cx,Y=H-20,G=470;PARTS.forEach(function(p){var tl=mod(u+p.ph,p.T),life=Math.min(p.T,1.5);if(tl>life||tl>u)return;var x=X+p.vx*tl,y=Y+p.vy*tl+.5*G*tl*tl,a=Math.min(1,tl/.06)*(1-smooth(PP(tl,life*.7,life))),sc=lerp(1.15,.7,tl/life);
    k.globalAlpha=a;k.fillStyle=p.col;k.shadowColor=p.col===WHITE||p.col===PASTEL?DEEP:WHITE;k.shadowBlur=4;k.save();k.translate(x,y);k.rotate(tl*p.spin);k.scale(sc,sc);
    if(p.kind===0){k.beginPath();k.arc(0,0,p.sz,0,7);k.fill()}else if(p.kind===1){k.fillRect(-p.sz,-p.sz,p.sz*2,p.sz*2)}else{k.beginPath();k.moveTo(0,-p.sz*1.3);k.lineTo(p.sz*1.2,p.sz);k.lineTo(-p.sz*1.2,p.sz);k.closePath();k.fill()}k.restore()});k.globalAlpha=1;k.shadowBlur=0}
  var GS=36/104,GL_START=1.6;
  var GL=(function(){var R=rand(231),st=[];for(var s=0;s<12;s++){var sl=[],n=2+Math.floor(R()*3);for(var i=0;i<n;i++)sl.push({y:Math.floor(40+R()*110),h:10+Math.floor(R()*26),dx:Math.round((R()<.5?-1:1)*(18+R()*46))});var bars=[];for(i=0;i<3;i++)bars.push({x:30+R()*420,y:30+R()*150,w:30+R()*90,h:5+R()*7,c:i});st.push({sl:sl,bars:bars,rgb:7+Math.round(R()*9)})}return st})();
  var glSl=[],glBars=[],glSi=-2;
  function glitchSetup(){glSl.concat(glBars).forEach(function(e){e.remove()});glSl=[];glBars=[];glSi=-2;
    for(var i=0;i<4;i++){var d=document.createElement("div");d.className="gl-sl";d.hidden=true;d.setAttribute("aria-hidden","true");Array.from(titleEl.querySelectorAll(".ltr")).forEach(function(s){d.appendChild(s.cloneNode(true))});titleEl.appendChild(d);glSl.push(d)}
    for(i=0;i<3;i++){var b=document.createElement("i");b.className="gl-bar";b.hidden=true;b.style.background=[DEEP,"#22D3EE",MID][i];titleEl.appendChild(b);glBars.push(b)}}
  function glitch(u){var step=.14,si=-1,lu=u-GL_START;if(lu>=0){lu=mod(lu,CYC);if(lu>=.55&&lu<.55+step*5)si=Math.floor((lu-.55)/step);else if(lu>=2.9&&lu<2.9+step*6)si=5+Math.floor((lu-2.9)/step)}
    if(si===glSi)return;glSi=si;titleEl.classList.toggle("is-gl",si>=0);if(si<0){glSl.concat(glBars).forEach(function(e){e.hidden=true});return}
    var S=GL[si],hh=titleEl.offsetHeight,tw=titleEl.offsetWidth,top=(hh-104*GS)/2;titleEl.style.setProperty("--rgb",(S.rgb*GS).toFixed(1)+"px");
    glSl.forEach(function(d,i){var sl=S.sl[i];if(!sl){d.hidden=true;return}var y0=top+(sl.y-52)*GS,y1=y0+sl.h*GS;d.hidden=false;d.style.clipPath="inset("+Math.max(0,y0).toFixed(1)+"px 0 "+Math.max(0,hh-y1).toFixed(1)+"px 0)";d.style.transform="translateX("+(sl.dx*GS).toFixed(1)+"px)"});
    glBars.forEach(function(b,i){var r=S.bars[i];b.hidden=false;b.style.left=(r.x/539*tw).toFixed(1)+"px";b.style.top=(top+(r.y-52)*GS).toFixed(1)+"px";b.style.width=(r.w*GS).toFixed(1)+"px";b.style.height=Math.max(2,r.h*GS).toFixed(1)+"px"})}
  glitchSetup();
  var P=[],S=[],rings=[],tw=[],t=0,t2=0,t0i=0,phase=1,raf=0,last=0,acc={sp:0,rain:0,st:0,ft:0},burst2=false;
  function spawnStreak(){var v=Math.random()<.5,n=Math.floor((v?W:H)/C),line=(1+Math.floor(Math.random()*Math.max(1,n-1)))*C-1,dir=Math.random()<.5?1:-1;S.push({v:v,l:line,p:dir>0?-60:(v?H:W)+60,d:dir,sp:rnd(120,220),len:rnd(50,95)})}
  function add(o){if(P.length<420)P.push(o)}
  function particle(kind,x,y,vx,vy,r,max,extra){var o={k:kind,x:x,y:y,vx:vx,vy:vy,r:r,rot:rnd(0,TAU),vr:rnd(-3,3),life:0,max:max,col:pick(COLS),g:0,drag:1,sway:0,ph:rnd(0,TAU)};for(var k in extra)o[k]=extra[k];add(o);return o}
  function burst(n,smin,smax){for(var i=0;i<n;i++){var a=rnd(0,TAU),s=rnd(smin,smax),kind=pick(["heart","heart","star","star","spark","dot"]);particle(kind,cx,cy,Math.cos(a)*s,Math.sin(a)*s,kind==="dot"?rnd(1.5,3):rnd(5,11),rnd(1.4,2.4),{g:70,drag:.22})}}
  function toPhase2(){phase=2;t2=0;pop.classList.add("is-p2");chip.textContent="STEP 2 · 변신 완료";steps[1].classList.add("on");flash.classList.remove("go");void flash.offsetWidth;flash.classList.add("go");rings=V==="heart"?[{r:10,v:420,a:1,c:DEEP},{r:4,v:300,a:1,c:MID},{r:0,v:200,a:1,c:DEEP}]:[];burst(90,140,420);if(MODE==="oath"){clearTimeout(autoT);autoT=setTimeout(function(){if(!bd.hidden&&MODE==="oath")close()},4200)}tw=[];for(var i=0;i<18;i++)tw.push({x:rnd(18,W-18),y:rnd(60,H*.72),r:rnd(4,9),ph:rnd(0,TAU),col:pick(COLS)})}
  function reset(){P=[];S=[];rings=[];tw=[];t=0;t2=0;phase=1;burst2=false;acc={sp:0,rain:0,st:0,ft:0};glitch(-1);pop.classList.remove("is-p2");chip.textContent="STEP 1 · 마법진 소환";steps[0].classList.add("on");steps[1].classList.remove("on");letters(chantEl,chantText,"");for(var i=0;i<4;i++){spawnStreak();S[i].p=(S[i].v?H:W)*(.15+i*.2)}}
  function update(dt){
    if(phase===0){acc.st+=dt;if(acc.st>.4&&S.length<8){acc.st=0;spawnStreak()}S.forEach(function(b){b.p+=b.d*b.sp*dt});S=S.filter(function(b){var lim=(b.v?H:W)+100;return b.d>0?b.p<lim:b.p>-100});t0i+=dt;return}
    t+=dt;
    if(phase===1){if(t>.15&&t<2.05){acc.sp+=dt;while(acc.sp>.022){acc.sp-=.022;var o=particle(pick(["star","spark","heart","dot"]),0,0,0,0,rnd(3,7),9,{polar:true,a:rnd(0,TAU),rad:rnd(150,Math.max(W,H)*.55),va:rnd(1.8,3),vr:rnd(40,80)});if(o.k==="dot")o.r=rnd(1.2,2.4)}}if(t>=2.45)toPhase2()}
    else{t2+=dt;acc.rain+=dt;while(acc.rain>.06){acc.rain-=.06;var k=pick(["star","heart","spark","spark","dot"]);particle(k,rnd(0,W),-14,rnd(-10,10),rnd(45,100),k==="dot"?rnd(1.2,2.2):rnd(3.5,7.5),rnd(5,8),{sway:rnd(12,30),g:0})}if(V==="heart"&&t2>.5&&t2<1.6){acc.ft+=dt;while(acc.ft>.035){acc.ft-=.035;particle("heart",cx+rnd(-30,30),H+10,rnd(-110,110),rnd(-520,-380),rnd(6,12),rnd(1.6,2.4),{g:380,drag:.6})}}if(t2>.9&&!burst2){burst2=true;burst(50,80,260);rings.push({r:20,v:260,a:.8,c:MID})}}
    acc.st+=dt;if(acc.st>(phase===1?.32:.24)&&S.length<12){acc.st=0;spawnStreak()}
    S.forEach(function(b){b.p+=b.d*b.sp*dt});S=S.filter(function(b){var lim=(b.v?H:W)+100;return b.d>0?b.p<lim:b.p>-100});
    P.forEach(function(p){p.life+=dt;p.rot+=p.vr*dt;if(p.polar){p.a+=p.va*dt;p.vr*=1+dt*1.6;p.rad-=p.vr*dt;p.x=cx+Math.cos(p.a)*p.rad;p.y=cy+Math.sin(p.a)*p.rad;if(p.rad<8)p.life=p.max}
      else{p.vy+=p.g*dt;var dr=Math.pow(p.drag,dt);p.vx*=dr;p.vy*=dr;p.x+=(p.vx+(p.sway?Math.cos(p.life*2+p.ph)*p.sway:0))*dt;p.y+=p.vy*dt;if(p.y>H+30)p.life=p.max}});
    P=P.filter(function(p){return p.life<p.max});rings.forEach(function(r){r.r+=r.v*dt;r.v*=Math.pow(.35,dt);r.a-=dt*.9});rings=rings.filter(function(r){return r.a>0})}
  function drawBg(){bg.clearRect(0,0,W,H);S.forEach(function(b){var x0=b.v?b.l:b.p-b.d*b.len,y0=b.v?b.p-b.d*b.len:b.l,x1=b.v?b.l:b.p,y1=b.v?b.p:b.l;var g=bg.createLinearGradient(x0,y0,x1,y1);g.addColorStop(0,"rgba("+STREAK+",0)");g.addColorStop(1,"rgba("+STREAK+",.95)");
    bg.strokeStyle=g;bg.lineWidth=1.6;bg.beginPath();bg.moveTo(x0+.5,y0+.5);bg.lineTo(x1+.5,y1+.5);bg.stroke();bg.fillStyle="rgb("+STREAK+")";bg.shadowColor="rgb("+STREAK+")";bg.shadowBlur=9;bg.beginPath();bg.arc(x1+.5,y1+.5,1.9,0,TAU);bg.fill();bg.shadowBlur=0})}
  function magicCircle(c,tt,alpha){var R=Math.min(W*.4,H*.27);var p1=ease(clamp(tt/.9)),p2=ease(clamp((tt-.25)/1)),p3=ease(clamp((tt-.5)/1)),p4=ease(clamp((tt-.95)/.8));var i,a,n;
    c.save();c.translate(cx,cy);c.globalAlpha=alpha;c.lineCap="round";c.lineJoin="round";
    var dg=c.createRadialGradient(0,0,R*.1,0,0,R*1.15);dg.addColorStop(0,"rgba(255,255,255,"+.7*p3+")");dg.addColorStop(.6,"rgba(255,211,230,"+.55*p2+")");dg.addColorStop(1,"rgba(255,211,230,0)");c.fillStyle=dg;c.beginPath();c.arc(0,0,R*1.15,0,TAU);c.fill();
    c.save();c.rotate(tt*.45);n=28;
    for(i=0;i<Math.floor(n*p1);i++){a=i/n*TAU;(function(a){glowStroke(c,function(){c.beginPath();c.arc(Math.cos(a)*R*1.09,Math.sin(a)*R*1.09,R*.05,a+Math.PI*.5,a+Math.PI*1.5,true)},1.2,.9)})(a);
      if(i%4===0){c.fillStyle=DEEP;c.shadowColor=WHITE;c.shadowBlur=10;sparkle(c,Math.cos(a)*R*1.2,Math.sin(a)*R*1.2,4.5,a)}else if(i%2===0){c.fillStyle=MID;c.shadowColor=WHITE;c.shadowBlur=8;heart(c,Math.cos(a)*R*1.19,Math.sin(a)*R*1.19,5,a+Math.PI/2)}}
    c.shadowBlur=0;var s1=-Math.PI/2,e1=s1+p1*TAU;
    glowStroke(c,function(){c.beginPath();c.arc(0,0,R,s1,e1)},2.2,1);glowStroke(c,function(){c.beginPath();c.arc(0,0,R*.965,s1,e1)},.9,.8);
    glowStroke(c,function(){c.beginPath();c.arc(0,0,R*.82,s1,s1-p1*TAU,true)},2.2,1);glowStroke(c,function(){c.beginPath();c.arc(0,0,R*.855,s1,s1-p1*TAU,true)},.9,.8);
    if(p1>=1){[[R,tt*2.6],[R*.82,-tt*3.1],[R,tt*2.6+Math.PI],[R*.82,-tt*3.1+Math.PI]].forEach(function(q){c.fillStyle=WHITE;c.shadowColor=DEEP;c.shadowBlur=14;c.beginPath();c.arc(Math.cos(q[1])*q[0],Math.sin(q[1])*q[0],3.2,0,TAU);c.fill()});c.shadowBlur=0}
    c.restore();
    c.save();c.rotate(-tt*.3);var chars=RUNES,shown=Math.floor(chars.length*p2);c.font=Math.round(R*.095)+"px "+RUNE_FONT;c.textAlign="center";c.textBaseline="middle";
    for(i=0;i<shown;i++){a=i/chars.length*TAU;c.save();c.rotate(a);c.translate(0,-R*.91);var ch=chars[i],sep=ch==="᛭",glow=.5+.5*Math.sin(tt*4-i*.35);c.fillStyle=sep?MID:DEEP;c.shadowColor=WHITE;c.shadowBlur=4+glow*8;c.fillText(ch,0,0);c.restore()}
    c.shadowBlur=0;n=72;
    for(i=0;i<Math.floor(n*p2);i++){a=i/n*TAU;var big=i%6===0,inR=R*(big?.7:i%3===0?.74:.77);c.globalAlpha=alpha*(big?1:.8);c.strokeStyle=big?DEEP:(i%2?MID:DEEP);c.shadowColor=WHITE;c.shadowBlur=big?8:0;c.lineWidth=big?1.8:1.1;c.beginPath();c.moveTo(Math.cos(a)*R*.8,Math.sin(a)*R*.8);c.lineTo(Math.cos(a)*inR,Math.sin(a)*inR);c.stroke();if(big){c.fillStyle=MID;sparkle(c,Math.cos(a)*R*.655,Math.sin(a)*R*.655,3.2,a)}}
    c.globalAlpha=alpha;c.shadowBlur=0;c.setLineDash([2,5]);glowStroke(c,function(){c.beginPath();c.arc(0,0,R*.62,0,p2*TAU)},1,.8);c.setLineDash([]);c.restore();
    c.save();c.rotate(-tt*.9);var pts=[],order=[0,2,4,1,3,0],PR=R*.6;for(i=0;i<5;i++){a=i/5*TAU-Math.PI/2;pts.push([Math.cos(a)*PR,Math.sin(a)*PR])}
    if(p4>0){var ir=PR*.382;c.globalAlpha=alpha*.55*p4;c.fillStyle=PASTEL;c.beginPath();for(i=0;i<5;i++){a=i/5*TAU+Math.PI/2;c.lineTo(Math.cos(a)*ir,Math.sin(a)*ir)}c.closePath();c.fill();c.globalAlpha=alpha;
      glowStroke(c,function(){c.beginPath();for(var j=0;j<5;j++){var b=j/5*TAU+Math.PI/2;c.lineTo(Math.cos(b)*ir,Math.sin(b)*ir)}c.closePath()},1,p4);glowStroke(c,function(){c.beginPath();c.arc(0,0,PR*.2,0,TAU)},.9,p4)}
    var sN=p3*5;function starPath(scale){c.beginPath();c.moveTo(pts[0][0]*scale,pts[0][1]*scale);for(var j=0;j<5&&j<sN;j++){var f=Math.min(1,sN-j),A=pts[order[j]],B=pts[order[j+1]];c.lineTo((A[0]+(B[0]-A[0])*f)*scale,(A[1]+(B[1]-A[1])*f)*scale)}}
    glowStroke(c,function(){starPath(1)},2.4,1);glowStroke(c,function(){starPath(.9)},.8,.7);glowStroke(c,function(){c.beginPath();c.arc(0,0,PR,0,p3*TAU)},1.4,.9);
    if(p4>0){pts.forEach(function(q,j){var sc=Math.sin(clamp(p4*1.2-j*.04)*Math.PI*.5)*(1+.25*Math.sin(p4*Math.PI));c.globalAlpha=alpha;c.fillStyle=DEEP;c.shadowColor=DEEP;c.shadowBlur=16;c.beginPath();c.arc(q[0],q[1],R*.085*sc,0,TAU);c.fill();
      c.shadowBlur=0;c.strokeStyle=WHITE;c.lineWidth=1.4;c.beginPath();c.arc(q[0],q[1],R*.085*sc,0,TAU);c.stroke();c.fillStyle=WHITE;if(j%2)heart(c,q[0],q[1],R*.06*sc,0);else star(c,q[0],q[1],R*.055*sc,0);c.fillStyle=MID;sparkle(c,q[0]*1.24,q[1]*1.24,5*sc,tt)})}
    c.restore();c.restore()}
  function drawP(c,p){var a=Math.min(1,p.life/.15)*(1-Math.max(0,(p.life-p.max*.6)/(p.max*.4)));if(p.polar)a=Math.min(1,p.life/.2)*clamp(p.rad/60);if(p.k==="spark")a*=.55+.45*Math.sin(p.life*12+p.ph);if(a<=0)return;
    c.globalAlpha=a;c.fillStyle=p.col;c.shadowColor=p.col===WHITE||p.col===PASTEL?DEEP:WHITE;c.shadowBlur=p.col===WHITE||p.col===PASTEL?6:5;
    if(p.k==="star")star(c,p.x,p.y,p.r,p.rot);else if(p.k==="heart")heart(c,p.x,p.y,p.r*1.3,p.rot*.3);else if(p.k==="spark")sparkle(c,p.x,p.y,p.r*1.3,p.rot*.2);else{c.beginPath();c.arc(p.x,p.y,p.r,0,TAU);c.fill()}}
  function drawFx(){var c=fx;c.clearRect(0,0,W,H);c.globalAlpha=1;
    if(phase===0){var q=.12+typeP*1.63;magicCircle(c,q+Math.sin(t0i*1.6)*.02,.32+typeP*.5);return}
    if(phase===1){magicCircle(c,t,1);var pa=clamp((t-1.25)/1.1);if(pa>0){var w=110*ease(pa),g=c.createLinearGradient(cx-w/2,0,cx+w/2,0);g.addColorStop(0,"rgba(238,91,156,0)");g.addColorStop(.22,"rgba(245,141,187,"+.45*pa+")");g.addColorStop(.5,"rgba(255,255,255,"+.95*pa+")");g.addColorStop(.78,"rgba(245,141,187,"+.45*pa+")");g.addColorStop(1,"rgba(238,91,156,0)");c.fillStyle=g;c.fillRect(cx-w/2,0,w,H)}
      var core=clamp(t/2.3),cg=c.createRadialGradient(cx,cy,0,cx,cy,14+core*46);cg.addColorStop(0,"rgba(255,255,255,"+(.5+core*.5)+")");cg.addColorStop(.45,"rgba(245,141,187,"+core*.75+")");cg.addColorStop(1,"rgba(238,91,156,0)");c.fillStyle=cg;c.beginPath();c.arc(cx,cy,14+core*46,0,TAU);c.fill();
      if(V==="moon"&&t>2.45-BT0)burstMoon(c,t-(2.45-BT0),clamp((t-(2.45-BT0))/.3))}
    else{magicCircle(c,t,.45);rings.forEach(function(r){c.globalAlpha=Math.max(0,r.a);c.strokeStyle=r.c;c.shadowColor=WHITE;c.shadowBlur=10;c.lineWidth=2.4;c.beginPath();c.arc(cx,cy,r.r,0,TAU);c.stroke()});
      tw.forEach(function(s){var a=(Math.sin(t2*3.2+s.ph)+1)/2*clamp(t2/.6);c.globalAlpha=a;c.fillStyle=s.col===WHITE?MID:s.col;c.shadowColor=WHITE;c.shadowBlur=8;sparkle(c,s.x,s.y,s.r*(.6+a*.5),0)});
      var sc=RM?1:Math.min(1,t2/.5),R=Math.min(W,H)*.26;for(var i=0;i<6;i++){var a2=t2*1.1+i/6*TAU;c.globalAlpha=sc;c.fillStyle=i%2?MID:DEEP;c.shadowColor=WHITE;c.shadowBlur=10;star(c,cx+Math.cos(a2)*R,cy+Math.sin(a2)*R*.55,6,a2)}
      c.globalAlpha=1;c.shadowBlur=0;
      if(V==="heart"){var bounce=sc<1?Math.sin(sc*Math.PI*.5)*(1+.3*Math.sin(sc*Math.PI)):1+.05*Math.sin(t2*4);c.shadowColor=MID;c.shadowBlur=24;c.fillStyle=DEEP;heart(c,cx,cy,34*bounce,0);c.shadowBlur=0;c.fillStyle=MID;heart(c,cx,cy+1,22*bounce,0);c.fillStyle=WHITE;heart(c,cx-9*bounce,cy-9*bounce,7*bounce,-.5);c.fillStyle=DEEP;c.shadowColor=WHITE;c.shadowBlur=8;sparkle(c,cx+26*bounce,cy-24*bounce,7*bounce,0)}
      else{fountain(c,t2);burstMoon(c,t2+BT0,1)}}
    P.forEach(function(p){drawP(c,p)});c.globalAlpha=1;c.shadowBlur=0}
  function frame(now){raf=0;if(bd.hidden)return;var dt=Math.min(.05,Math.max(0,(now-last)/1000));last=now;update(dt);drawBg();drawFx();glitch(phase===2&&V==="moon"?t2:-1);raf=requestAnimationFrame(frame)}
  function staticEnd(){reset();S=[];toPhase2();P=[];rings=[];t=3;t2=3;for(var i=0;i<34;i++)particle(pick(["star","heart","spark","dot"]),rnd(14,W-14),rnd(56,H-170),0,0,rnd(3,8),Infinity,{});P.forEach(function(p){p.life=1;if(p.k==="dot")p.r=2});drawBg();drawFx()}
  function start(){resize();if(raf){cancelAnimationFrame(raf);raf=0}if(RM){staticEnd();return}reset();last=performance.now();raf=requestAnimationFrame(frame)}
  function close(){if(bd.hidden)return;if(MODE==="oath"&&phase!==2)return;clearTimeout(autoT);bd.hidden=true;if(raf)cancelAnimationFrame(raf);raf=0;document.body.style.overflow=TF.prevOv||"";if(opener&&opener.focus&&document.body.contains(opener))opener.focus();if(TF.onClose)TF.onClose()}
  function open(o){o=o||{};opener=document.activeElement;chantText=o.chant||chantText;MODE="";V="moon";typeF.hidden=true;xBtn.hidden=false;acts.hidden=false;acts.innerHTML="";actsOrig.forEach(function(b){acts.appendChild(b)});pop.classList.remove("is-type");letters(titleEl,"별빛 변신 완료!","ltr");titleEl.setAttribute("aria-label","별빛 변신 완료!");glitchSetup();
    var tp=bd.querySelector(".mgtf-top");if(o.top){tp.hidden=false;tp.textContent=o.top.label+" 주문 · ‘"+o.top.text+"’ — "+o.top.by}else tp.hidden=true;
    bd.querySelector(".mgtf-msg").innerHTML="";var m=bd.querySelector(".mgtf-msg");(o.lines||["반짝이는 별빛과 두근대는 하트의 힘으로","오늘도 출동 준비 끝!"]).forEach(function(l,i){if(i)m.appendChild(document.createElement("br"));m.appendChild(document.createTextNode(l))});
    TF.prevOv=document.body.style.overflow;document.body.style.overflow="hidden";TF.onClose=o.onClose||null;
    bd.hidden=false;pop.style.animation="none";void pop.offsetWidth;pop.style.animation="";start();bd.querySelector(".mgtf-x").focus()}
  // ── 맹세 주문: 타이핑 → 변신(하트판) → 유저 화면 ──
  function oathOpen(o){
    opener=document.activeElement;MODE="oath";V="heart";chantText=o.phrase;TF.onClose=o.onDone||null;
    TF.prevOv=document.body.style.overflow;document.body.style.overflow="hidden";
    xBtn.hidden=true;acts.hidden=true;typeF.hidden=false;pop.classList.add("is-type");bd.querySelector(".mgtf-top").hidden=true;
    letters(titleEl,"맹세 변신 완료!","ltr");titleEl.setAttribute("aria-label","맹세 변신 완료!");glSl=[];glBars=[];glSi=-2;titleEl.classList.remove("is-gl");
    bd.querySelector(".mgtf-msg").textContent="";var m=bd.querySelector(".mgtf-msg");["붉은 달 아래 맹세를 새겼어요.","잠시 뒤 헌터 화면으로 이동해요."].forEach(function(l,i){if(i)m.appendChild(document.createElement("br"));m.appendChild(document.createTextNode(l))});
    var go2=el("button","go","✦ 헌터 화면으로");go2.type="button";go2.addEventListener("click",close);acts.innerHTML="";acts.appendChild(go2);
    typeTg.innerHTML="";Array.from(o.phrase).forEach(function(ch){var sp=el("span",ch===" "?"mgsp":"",ch===" "?"\u00a0":ch);typeTg.appendChild(sp)});
    typeIn.value="";typeMsg.textContent="";typeP=0;
    bd.hidden=false;pop.style.animation="none";void pop.offsetWidth;pop.style.animation="";
    resize();if(raf){cancelAnimationFrame(raf);raf=0}
    P=[];S=[];rings=[];tw=[];phase=0;t=0;t2=0;t0i=0;acc={sp:0,rain:0,st:0,ft:0};chip.textContent="STEP 0 · 맹세 영창";steps[0].classList.remove("on");steps[1].classList.remove("on");pop.classList.remove("is-p2");chantEl.innerHTML="";
    for(var i=0;i<3;i++){spawnStreak();S[i].p=(S[i].v?H:W)*(.2+i*.25)}
    if(RM){drawBg();drawFx()}else{last=performance.now();raf=requestAnimationFrame(frame)}
    setTimeout(function(){typeIn.focus()},350);
  }
  function oathNorm(t){return String(t||"").normalize("NFC").replace(/\s+/g," ").trim()}
  function typePaint(){
    var tgt=Array.from(chantText),cur=Array.from(typeIn.value.normalize("NFC").replace(/\s+/g," ").replace(/^ /,"")),ok=0;
    Array.prototype.forEach.call(typeTg.children,function(sp,i){var c=cur[i];sp.className=(tgt[i]===" "?"mgsp ":"")+(c===undefined?"":c===tgt[i]?"ok":(i===cur.length-1?"now":"bad"))});
    for(var i=0;i<cur.length&&i<tgt.length;i++){if(cur[i]===tgt[i])ok++;else break}
    typeP=Math.min(1,ok/tgt.length);if(RM)drawFx();
  }
  typeIn.addEventListener("input",typePaint);typeIn.addEventListener("compositionend",typePaint);
  typeF.addEventListener("submit",function(e){e.preventDefault();if(MODE!=="oath"||phase!==0)return;
    var v=oathNorm(typeIn.value);
    if(v!==oathNorm(chantText)){typeMsg.textContent=v?"주문이 달라요. 글자와 쉼표까지 똑같이 적어 주세요.":"맹세 주문을 적어 주세요.";typeF.classList.remove("shake");void typeF.offsetWidth;typeF.classList.add("shake");return}
    var b=typeF.querySelector(".go");b.disabled=true;typeMsg.textContent="영창 중…";
    call("POST","/api/mg/oath",{text:v}).then(function(r){b.disabled=false;
      if(!r||!r.ok){typeMsg.textContent=r&&r.error==="event_off"?"이벤트가 끝났어요. 그대로 들어갈게요.":"확인하지 못했어요. 다시 눌러 주세요.";if(r&&r.error==="event_off"){MODE="";phase=2;close()}return}
      typeF.hidden=true;pop.classList.remove("is-type");typeIn.blur();acts.hidden=false;
      clearTimeout(autoT);autoT=setTimeout(function(){if(!bd.hidden&&MODE==="oath"){phase=2;close()}},7500);      /* 화면이 느려 애니메이션이 늦어져도 7.5초 뒤에는 넘어감 */
      if(RM){staticEnd();setTimeout(close,2600);return}
      reset();phase=1;last=performance.now();if(!raf)raf=requestAnimationFrame(frame);
      setTimeout(function(){var g=acts.querySelector(".go");if(g&&!bd.hidden)g.focus()},2900);
    });
  });
  typeF.querySelector(".out").addEventListener("click",function(){call("POST","/api/logout",{}).then(function(){location.reload()})});
  bd.querySelector(".mgtf-acts .go").addEventListener("click",function(){if(MODE!=="oath")start()});
  bd.querySelector(".mgtf-acts .no").addEventListener("click",close);
  bd.querySelector(".mgtf-x").addEventListener("click",close);
  bd.addEventListener("click",function(e){if(e.target===bd&&MODE!=="oath")close()});
  document.addEventListener("keydown",function(e){if(bd.hidden)return;
    if(e.key==="Escape"){e.stopPropagation();e.preventDefault();if(MODE!=="oath")close()}
    if(e.key==="Tab"){var f=Array.from(pop.querySelectorAll("button,input")).filter(function(b){return !b.closest("[hidden]")&&b.offsetParent!==null}).filter(function(b){return getComputedStyle(b.closest(".mgtf-foot")||b).pointerEvents!=="none"});var i=f.indexOf(document.activeElement);if(e.shiftKey&&i<=0){e.preventDefault();f[f.length-1].focus()}else if(!e.shiftKey&&i===f.length-1){e.preventDefault();f[0].focus()}}},true);
  pop.addEventListener("pointermove",function(e){var r=pop.getBoundingClientRect();pop.style.setProperty("--mx",(e.clientX-r.left)+"px");pop.style.setProperty("--my",(e.clientY-r.top)+"px")});
  pop.addEventListener("pointerleave",function(){pop.style.setProperty("--mx","-300px");pop.style.setProperty("--my","-300px")});
  if("ResizeObserver" in window)new ResizeObserver(function(){if(bd.hidden)return;resize();if(RM){drawBg();drawFx()}}).observe(pop);
  TF={open:open,close:close,oath:oathOpen,el:bd};return TF;
}

/* ═════════ 기기 앱 '마법소녀' ═════════ */
var TABS=[["tf","변신"],["fairy","요정"],["diary","일기장"],["mail","우체통"],["ribbon","리본"],["mirror","거울 나라"],["spell","주문"],["cos","코스튬"],["song","정화의 노래"],["star","별자리"]];
var cur="tf",D=null,timer=0,root=null;
function mount(scr){
  root=el("div","mgs-w");scr.appendChild(root);
  var tb=el("div","mgs-tabs");tb.setAttribute("role","tablist");root.appendChild(tb);
  var body=el("div","mgs-body");root.appendChild(body);
  tabSlide(tb);
  TABS.forEach(function(t){var b=btn("mgs-tab",t[1],function(){cur=t[0];paint()});b.setAttribute("role","tab");b.dataset.k=t[0];var n=t[0]==="mail"?ST.mail:t[0]==="ribbon"?ST.ribReq:t[0]==="fairy"?ST.letters:0;if(n){b.appendChild(el("span","mgs-tabn",String(n)));b.setAttribute("aria-label",t[1]+" (새 소식 "+n+")")}tb.appendChild(b)});
  function paint(){Array.prototype.forEach.call(tb.children,function(b){var o=b.dataset.k===cur;b.classList.toggle("on",o);b.setAttribute("aria-selected",o?"true":"false");if(o&&tb._show)tb._show(b)});body.innerHTML="";clearInterval(timer);songStop();
    if(!D){body.appendChild(el("p","app-empty","불러오는 중…"));return}
    ({tf:vTf,fairy:vFairy,diary:vDiary,mail:vMail,ribbon:vRibbon,mirror:vMirror,spell:vSpell,cos:vCos,song:vSong,star:vStar})[cur](body)}
  root._paint=paint;
  load();
}
/* 탭 줄: 한 줄에 다 안 들어가면 휠(세로 스크롤)·끌기·양옆 화살표로 옆으로 미끄러지듯 넘어갑니다 */
function tabSlide(tb){
  var wrap=el("div","mgs-tabw");tb.parentNode.insertBefore(wrap,tb);wrap.appendChild(tb);
  var L=btn("mgs-tabar l","‹",function(){go(-1)}),R=btn("mgs-tabar r","›",function(){go(1)});L.setAttribute("aria-label","이전 탭 보기");R.setAttribute("aria-label","다음 탭 보기");L.tabIndex=R.tabIndex=-1;wrap.appendChild(L);wrap.appendChild(R);
  var target=null,raf=0;
  function upd(){var max=tb.scrollWidth-tb.clientWidth;wrap.classList.toggle("can-l",tb.scrollLeft>2);wrap.classList.toggle("can-r",tb.scrollLeft<max-2)}
  function glide(to){var max=tb.scrollWidth-tb.clientWidth;target=Math.max(0,Math.min(max,to));if(RM){tb.scrollLeft=target;target=null;upd();return}if(!raf)raf=requestAnimationFrame(step)}
  function step(){raf=0;if(target==null)return;var d=target-tb.scrollLeft;if(Math.abs(d)<.6){tb.scrollLeft=target;target=null;upd();return}tb.scrollLeft+=d*.22;upd();raf=requestAnimationFrame(step)}
  function go(dir){glide((target==null?tb.scrollLeft:target)+dir*tb.clientWidth*.7)}
  tb.addEventListener("wheel",function(e){var max=tb.scrollWidth-tb.clientWidth;if(max<=0)return;var d=Math.abs(e.deltaY)>Math.abs(e.deltaX)?e.deltaY:e.deltaX;if(e.deltaMode===1)d*=32;
    var c=target==null?tb.scrollLeft:target;if((d<0&&c<=0)||(d>0&&c>=max))return;e.preventDefault();glide(c+d*1.2)},{passive:false});
  var dn=null,moved=false;
  tb.addEventListener("pointerdown",function(e){if(e.pointerType!=="mouse"||e.button!==0)return;dn={x:e.clientX,s:tb.scrollLeft};moved=false});
  window.addEventListener("pointermove",function(e){if(!dn)return;var dx=e.clientX-dn.x;if(Math.abs(dx)>5)moved=true;if(moved){target=null;tb.scrollLeft=dn.s-dx;upd()}});
  window.addEventListener("pointerup",function(){if(!dn)return;dn=null;if(moved)setTimeout(function(){moved=false},0)});
  tb.addEventListener("click",function(e){if(moved){e.stopPropagation();e.preventDefault()}},true);
  tb.addEventListener("scroll",upd,{passive:true});
  tb._show=function(b){var l=b.offsetLeft-tb.offsetLeft,r=l+b.offsetWidth;if(l<tb.scrollLeft+24)glide(l-32);else if(r>tb.scrollLeft+tb.clientWidth-24)glide(r-tb.clientWidth+32)};
  if("ResizeObserver" in window)new ResizeObserver(upd).observe(tb);setTimeout(upd,0);
}
function load(){
  var r0=root;
  call("GET","/api/mg").then(function(r){
    if(!r0||!r0.isConnected)return;
    if(!r||r._status!==200){r0.querySelector(".mgs-body").innerHTML="";r0.querySelector(".mgs-body").appendChild(el("p","app-empty",r&&r.error==="event_off"?"마법소녀 이벤트가 끝났어요.":"정보를 불러오지 못했어요."));return}
    D=r;D._skew=Date.now()-r.now;r0._paint();
  });
}
function nowS(){return Date.now()-(D?D._skew:0)}
function card(p,title){var c=el("section","mgs-card");if(title)c.appendChild(el("h4",null,title));p.appendChild(c);return c}
function note(p,t,cls){var e=el("p","mgs-note"+(cls?" "+cls:""),t);p.appendChild(e);return e}

/* ── 변신 ── */
function vTf(body){
  var top=el("div","mgs-tfhero");body.appendChild(top);
  var side=el("div","mgs-tfside");top.appendChild(side);
  var st=el("p","mgs-tfst");side.appendChild(st);
  var go=btn("mgs-go","✦ 변신하기");side.appendChild(go);
  var sub=el("p","mgs-note");side.appendChild(sub);
  var fx=D.fx;
  function tick(){
    var n=nowS(),u=D.tf.until,nx=D.tf.next;
    if(u>n){st.innerHTML="";st.appendChild(el("b",null,"변신 중"));st.appendChild(document.createTextNode(" · 남은 시간 "+hms(u-n)));top.classList.add("is-on")}
    else{st.textContent=nx>n?"변신이 풀렸어요":"변신할 수 있어요!";top.classList.remove("is-on")}
    if(nx>n){go.disabled=true;go.textContent="다음 변신까지 "+hms(nx-n)}else{go.disabled=false;go.textContent="✦ 변신하기"}
  }
  sub.textContent="한 번 변신하면 "+D.buffMin+"분 동안 경험치·골드 +"+Math.round(fx.exp*100)+"% · 체력 피해 -"+fx.hpGuard+"%. 변신하고 "+Math.round(D.cdMin/60)+"시간 뒤에 다시 변신할 수 있어요.";
  tick();timer=setInterval(function(){if(!go.isConnected){clearInterval(timer);return}tick()},1000);
  go.addEventListener("click",function(){
    go.disabled=true;
    call("POST","/api/mg/transform").then(function(r){
      if(!r||r._status!==200){go.disabled=false;toast(r&&r.error==="cooldown"?"아직 다음 변신까지 시간이 남았어요.":r&&r.error==="event_off"?"마법소녀 이벤트가 끝났어요.":"변신하지 못했어요.");if(r&&r.next){D.tf.next=r.next;tick()}return}
      D.tf.until=r.until;D.tf.next=r.next;D.tf.today++;D.tf.total++;D._skew=Date.now()-r.now;
      var lines=[D.buffMin+"분 동안 경험치·골드 +"+Math.round(fx.exp*100)+"% · 체력 피해 -"+fx.hpGuard+"%"];
      lines.push(r.fairy&&r.fairy.extra?"요정 "+r.fairy.ko+"의 기분이 좋아서 변신 시간 +"+r.fairy.extra+"분":"오늘도 출동 준비 끝!");
      tfBuild().open({chant:r.chant,top:r.top,lines:lines,onClose:function(){if(root&&root.isConnected)root._paint()}});
      tick();if(window.pollState)window.pollState(false);
    });
  });
  var c1=card(body,"오늘의 기록");
  var ul=el("ul","mgs-kv");c1.appendChild(ul);
  [["오늘 변신",D.tf.today+"회"],["지금까지",D.tf.total+"회"],["오늘의 별자리",D.star.done?D.star.ko+" · "+D.star.txt:"아직 잇지 않았어요 (별자리 탭)"]].forEach(function(x){var li=el("li");li.appendChild(el("small",null,x[0]));li.appendChild(el("b",null,x[1]));ul.appendChild(li)});
  var c2=card(body,"오늘의 변신 주문 (모든 헌터 공통)");
  c2.appendChild(el("p","mgs-chant","‘"+(D.chant||D.defSpell)+"’"));
  note(c2,D.top?"어제 반짝 "+D.top.votes+"개로 1위를 한 "+D.top.by+" 님의 주문이에요. 오늘 1위 주문은 내일 모든 헌터의 주문이 돼요. (주문 탭)":"어제 투표된 주문이 없어서 기본 주문을 외쳐요. 주문 탭에서 오늘의 주문을 지어 투표해 보세요!");
}

/* ── 1 변신 주문 ── */
function vSpell(body){
  var top=card(body,"오늘의 변신 주문");var tb=el("div");top.appendChild(tb);
  var c=card(body,"오늘 내가 지은 주문");
  var f=el("form","mgs-form");var inp=el("input");inp.type="text";inp.maxLength=60;inp.placeholder="예) 별빛이여, 나에게 날개를!";inp.value=D.spell?D.spell.text:"";inp.setAttribute("aria-label","오늘 지을 주문");f.appendChild(inp);
  var cnt=el("small","mgs-cnt");f.appendChild(cnt);var sv=el("button","mgs-go mgs-sm","저장");sv.type="submit";f.appendChild(sv);c.appendChild(f);
  var msg=note(c,"매일 새 주문을 하나 지을 수 있어요. 오늘 '반짝'을 가장 많이 받은 주문은 내일 모든 헌터의 변신 주문이 돼요. 문장을 고치면 오늘 받은 반짝은 0부터 다시 시작해요.");
  function cc(){var n=Array.from(inp.value.trim()).length;cnt.textContent=n+" / 30";cnt.classList.toggle("over",n>30)}inp.addEventListener("input",cc);cc();
  f.addEventListener("submit",function(e){e.preventDefault();var t=inp.value.trim();if(!t||Array.from(t).length>30){msg.textContent="주문은 1~30자로 적어 주세요.";return}
    sv.disabled=true;call("POST","/api/mg/spell",{text:t}).then(function(r){sv.disabled=false;if(r&&r.ok){msg.textContent=r.same?"이미 이 주문이에요.":"오늘의 주문 후보로 올렸어요! 반짝을 많이 받으면 내일 모두가 외쳐요.";D.spell={text:t,votes:r.reset?0:(D.spell?D.spell.votes:0)};list()}else msg.textContent=r&&r.error==="rate_limited"?"잠시 후 다시 시도해 주세요.":"저장하지 못했어요."})});
  var c2=card(body,"오늘의 주문 투표 (내일의 주문)");var box=el("div");c2.appendChild(box);
  function list(){box.innerHTML="";box.appendChild(el("p","mgs-note","불러오는 중…"));
    call("GET","/api/mg/spells").then(function(r){box.innerHTML="";if(!r||r._status!==200){box.appendChild(el("p","mgs-note","불러오지 못했어요."));return}
      tb.innerHTML="";tb.appendChild(el("p","mgs-chant","‘"+r.chant+"’"));tb.appendChild(el("p","mgs-note",r.top?"어제 반짝 "+r.top.votes+"개로 1위 — "+r.top.by+" 님 · 오늘 모든 헌터가 이 주문으로 변신해요.":"어제 투표된 주문이 없어서 기본 주문이에요."));
      var h=Math.floor(r.resetIn/3600000),m=Math.floor(r.resetIn%3600000/60000);
      box.appendChild(el("p","mgs-note","오늘 남은 반짝 "+r.left+" / "+r.votes+" · 같은 주문에는 한 번만 · 투표 마감까지 "+(h?h+"시간 ":"")+m+"분 (자정)"));
      if(!r.list.length){box.appendChild(el("p","app-empty","아직 오늘 지은 주문이 없어요. 첫 주문을 지어 보세요!"));return}
      var ol=el("ol","mgs-sl");r.list.forEach(function(x){var li=el("li",x.me?"me":"");li.appendChild(el("span","n",String(x.no)));var tx=el("span","tx");tx.appendChild(el("b",null,"‘"+x.text+"’"));tx.appendChild(el("small",null,x.by+(x.me?" (나)":"")+(x.no===1&&x.votes>0?" · 지금 1위 (내일의 주문)":"")));li.appendChild(tx);
        var v=btn("mgs-vote"+(x.voted?" on":""),"✦ "+x.votes);v.setAttribute("aria-label","반짝 "+x.votes+(x.voted?" (누름)":""));v.disabled=x.me||x.voted||r.left<=0;
        v.addEventListener("click",function(){v.disabled=true;call("POST","/api/mg/spell/vote",{id:x.id}).then(function(q){if(q&&q.ok){toast("‘"+x.text+"’에 반짝을 보냈어요!");list()}else{toast(q&&q.error==="no_votes"?"오늘 반짝을 모두 썼어요.":q&&q.error==="voted"?"이미 반짝을 보냈어요.":"보내지 못했어요.");v.disabled=false}})});
        li.appendChild(v);ol.appendChild(li)});box.appendChild(ol)})}
  list();
}

/* ── 2 코스튬 ── */
function vCos(body){
  var sel=Object.assign({r:"bow",s:"pants",c:"sakura",w:"star"},D.cos||{});
  var wrap=el("div","mgs-cosw");body.appendChild(wrap);
  var now=el("div","mgs-cosnow");now.appendChild(el("small",null,"지금 고른 코스튬"));var tagBox=el("div");now.appendChild(tagBox);wrap.appendChild(now);
  var pane=el("div","mgs-cosp");wrap.appendChild(pane);
  function redraw(){tagBox.innerHTML="";tagBox.appendChild(cosTag(sel,"big"))}redraw();
  ["r","s","c","w"].forEach(function(k){var g=el("div","mgs-parts");g.appendChild(el("b",null,PART_KO[k]));var row=el("div","mgs-chips");g.appendChild(row);
    D.parts[k].concat((D.shop||[]).filter(function(x){return x.k===k}).map(function(x){return [x.v,x.ko,x]})).forEach(function(p){var sh=p[2],b=btn("mgs-chip"+(k==="c"?" col":"")+(sh?" shop":""),sh&&!sh.own?"🔒 "+p[1]+" · 조각 "+sh.cost:p[1]);if(sh&&!sh.own){b.disabled=true;b.title="거울 나라 탭의 거울 상점에서 살 수 있어요"}if(k==="c")b.style.setProperty("--c",COS_COL[p[0]]);b.setAttribute("aria-pressed",sel[k]===p[0]?"true":"false");
      b.addEventListener("click",function(){sel[k]=p[0];Array.prototype.forEach.call(row.children,function(x){x.setAttribute("aria-pressed","false")});b.setAttribute("aria-pressed","true");redraw()});row.appendChild(b)});
    pane.appendChild(g)});
  /* 마법 의상: 입은 의상의 속성 마법을 전투에서 쓸 수 있어요 (요정의 기본 속성 의상은 처음부터 가지고 있음 · 그 밖의 의상은 거울 조각으로) */
  var mg=el("div","mgs-parts mgs-outfit");mg.appendChild(el("b",null,PART_KO.e+" · 속성 마법"));var orow=el("div","mgs-chips");mg.appendChild(orow);var onote=el("p","mgs-note","불러오는 중…");mg.appendChild(onote);pane.appendChild(mg);
  var sv=btn("mgs-go","코스튬 저장");pane.appendChild(sv);var msg=note(pane,"저장한 코스튬은 간단 프로필과 PVP 대전 화면에 이름표로 보여요. 마법 의상을 갈아입으면 전투의 속성 공격에 그 속성 마법이 더해져요.");
  function outfits(){call("GET","/api/mg/magic").then(function(M){if(!orow.isConnected)return;orow.innerHTML="";
    if(!M||M._status!==200){onote.textContent="불러오지 못했어요.";return}
    if(!M.fairy){onote.textContent="요정과 계약하면 그 요정의 기본 속성 마법을 쓸 수 있어요. (요정 탭)"}
    else onote.textContent="계약한 요정의 기본 속성: "+M.elKo[M.base]+" (늘 사용) · 다른 속성은 의상을 갈아입거나(거울 조각 "+M.outfits[0].cost+"개) 상점의 속성 룬(1개 = 1번)으로 · 가진 조각 "+M.shards+"개";
    var none=btn("mgs-chip","입지 않음");none.setAttribute("aria-pressed",!sel.e?"true":"false");none.addEventListener("click",function(){delete sel.e;outfits();redraw()});orow.appendChild(none);
    M.outfits.forEach(function(o){var b=btn("mgs-chip el"+(o.own?"":" shop"),(o.own?"":"🔒 ")+o.name+(o.base?" ✦기본":"")+(o.own?"":" · 조각 "+o.cost));b.setAttribute("aria-pressed",sel.e===o.el?"true":"false");
      b.addEventListener("click",function(){
        if(o.own){sel.e=o.el;Array.prototype.forEach.call(orow.children,function(x){x.setAttribute("aria-pressed","false")});b.setAttribute("aria-pressed","true");redraw();return}
        if(b.dataset.ok!=="1"){b.dataset.ok="1";b.textContent="조각 "+o.cost+"개로 살까요? 한 번 더 누르세요";return}
        b.disabled=true;call("POST","/api/mg/outfit/buy",{el:o.el}).then(function(q){if(q&&q.ok){toast("✦ "+q.name+"을(를) 샀어요! 입고 저장하면 "+EL_KO[o.el]+" 속성 마법을 쓸 수 있어요.");sel.e=o.el;redraw();outfits()}else{b.disabled=false;b.dataset.ok="";b.textContent="🔒 "+o.name+" · 조각 "+o.cost;toast(q&&q.error==="no_shards"?"거울 조각이 모자라요. (거울 나라 탭에서 얻어요)":"사지 못했어요.")}})});orow.appendChild(b)})})}
  outfits();
  sv.addEventListener("click",function(){sv.disabled=true;call("POST","/api/mg/costume",sel).then(function(r){sv.disabled=false;if(r&&r.ok){D.cos=r.cos;msg.textContent="코스튬을 저장했어요!"+(r.cos.e?" 전투에서 "+EL_KO[r.cos.e]+" 속성 마법을 쓸 수 있어요.":"");if(window.pollState)window.pollState(false)}else msg.textContent=r&&r.error==="not_owned"?"아직 사지 않은 의상이 있어요.":"저장하지 못했어요."})});
}

/* ── 3 팀 ── */
var TCOL={pink:"#f58dbb",sky:"#7cc4f5",yellow:"#f5cf5a"};
function vTeam(body){
  var box=el("div");body.appendChild(box);box.appendChild(el("p","app-empty","불러오는 중…"));
  function err(e){return {in_team:"이미 팀에 들어가 있어요.",bad_name:"팀 이름은 1~12자로 지어 주세요.",no_user:"그런 헌터를 찾을 수 없어요.",not_friend:"친구에게만 팀 초대를 보낼 수 있어요.",target_in_team:"상대가 이미 다른 팀에 있어요.",full:"팀이 꽉 찼어요. (초대 중인 사람 포함 3명)",self:"자기 자신은 초대할 수 없어요.",color_taken:"다른 팀원이 쓰고 있는 색이에요.",gone:"초대가 끝났거나 취소됐어요.",rate_limited:"잠시 후 다시 시도해 주세요."}[e]||"처리하지 못했어요."}
  function draw(v){box.innerHTML="";
    if(v.invites&&v.invites.length&&!v.team){var ci=card(box,"받은 팀 초대");v.invites.forEach(function(i){var row=el("div","mgs-inv");row.appendChild(el("span",null,i.from+" 님의 팀 ‘"+i.name+"’"));
      row.appendChild(btn("mgs-go mgs-sm","수락",function(){call("POST","/api/mg/team/answer",{leader:i.leader,yes:true}).then(function(r){if(r&&r.ok){D.teamOn=true;draw(r)}else toast(err(r&&r.error))})}));
      row.appendChild(btn("mgs-ghost mgs-sm","거절",function(){call("POST","/api/mg/team/answer",{leader:i.leader,yes:false}).then(function(r){if(r&&r.ok)draw(r)})}));ci.appendChild(row)})}
    if(!v.team){var c=card(box,"마법소녀 팀 만들기");note(c,"친구 2명과 3인 팀을 만들어요. 함께 탐험하는 게 아니라, 각자 플레이하고 함께 기록돼요. 팀원 모두가 같은 날 변신하면 '합동 변신' 보너스가 붙어요.");
      var f=el("form","mgs-form");var ni=el("input");ni.type="text";ni.maxLength=24;ni.placeholder="팀 이름 (12자)";ni.setAttribute("aria-label","팀 이름");f.appendChild(ni);
      var col="pink",cr=el("div","mgs-cols");v.colors.forEach(function(k){var b=btn("mgs-colb "+k,v.colorKo[k]);b.setAttribute("aria-pressed",k===col?"true":"false");b.addEventListener("click",function(){col=k;Array.prototype.forEach.call(cr.children,function(x){x.setAttribute("aria-pressed","false")});b.setAttribute("aria-pressed","true")});cr.appendChild(b)});
      var sb=el("button","mgs-go mgs-sm","팀 만들기");sb.type="submit";c.appendChild(f);c.appendChild(el("small","mgs-lab","내 대표색"));c.appendChild(cr);f.appendChild(sb);var m=note(c,"");
      f.addEventListener("submit",function(e){e.preventDefault();sb.disabled=true;call("POST","/api/mg/team/create",{name:ni.value.trim(),color:col}).then(function(r){sb.disabled=false;if(r&&r.ok){D.teamOn=true;draw(r)}else m.textContent=err(r&&r.error)})});
      return}
    var t=v.team,c2=card(box,null);c2.classList.add("mgs-teamc");
    var hd=el("div","mgs-teamh");hd.appendChild(el("b",null,"✦ "+t.name));var stars=el("span","mgs-stars");stars.setAttribute("aria-label","오늘 변신한 팀원 "+t.mem.filter(function(m){return m.today}).length+" / 3");
    for(var i=0;i<3;i++){var m=t.mem[i],s=el("i",null,m&&m.today?"★":"☆");if(m)s.style.color=TCOL[m.color];stars.appendChild(s)}hd.appendChild(stars);c2.appendChild(hd);
    c2.appendChild(el("p","mgs-note",t.joint?"오늘 합동 변신 달성! 변신 중에는 경험치·골드 +"+Math.round(D.joint.exp*100)+"% · 행운 +"+D.joint.luck+"이 더 붙어요.":t.mem.length<3?"팀원이 3명이 되어야 합동 변신을 할 수 있어요.":"팀원 3명이 모두 오늘 변신하면 합동 변신 보너스가 붙어요."));
    var ul=el("ul","mgs-mem");for(i=0;i<3;i++){var mm=t.mem[i],li=el("li",mm?"":"empty");li.style.setProperty("--tc",mm?TCOL[mm.color]:"transparent");
      if(mm){li.appendChild(el("i","dot"));li.appendChild(el("b",null,mm.name+(mm.me?" (나)":"")+(mm.leader?" · 팀장":"")));li.appendChild(el("small",null,v.colorKo[mm.color]+" · "+(mm.today?"오늘 변신 ★":"아직 변신 전")))}
      else li.appendChild(el("small",null,t.pend[i-t.mem.length]?t.pend[i-t.mem.length]+" 님 초대 수락 대기":"빈 자리"));ul.appendChild(li)}c2.appendChild(ul);
    var me=t.mem.filter(function(x){return x.me})[0];
    var cc=card(box,"내 대표색");var cr2=el("div","mgs-cols");v.colors.forEach(function(k){var taken=t.mem.some(function(x){return !x.me&&x.color===k});var b=btn("mgs-colb "+k,v.colorKo[k]+(taken?" (사용 중)":""));b.disabled=taken;b.setAttribute("aria-pressed",me&&me.color===k?"true":"false");
      b.addEventListener("click",function(){call("POST","/api/mg/team/color",{color:k}).then(function(r){if(r&&r.ok)draw(r);else toast(err(r&&r.error))})});cr2.appendChild(b)});cc.appendChild(cr2);
    if(t.leader&&!t.full){var ic=card(box,"친구 초대");var f2=el("form","mgs-form");var ti=el("input");ti.type="text";ti.maxLength=40;ti.placeholder="친구 닉네임 또는 코드";ti.setAttribute("aria-label","초대할 친구");f2.appendChild(ti);var ib=el("button","mgs-go mgs-sm","초대");ib.type="submit";f2.appendChild(ib);ic.appendChild(f2);var im=note(ic,"");
      f2.addEventListener("submit",function(e){e.preventDefault();ib.disabled=true;call("POST","/api/mg/team/invite",{target:ti.value.trim()}).then(function(r){ib.disabled=false;if(r&&r.ok){im.textContent=r.to+" 님에게 팀 초대를 보냈어요.";setTimeout(function(){draw(r)},900)}else im.textContent=err(r&&r.error)})})}
    var lv=btn("mgs-ghost",t.leader?"팀 해산하기":"팀 나가기",function(){if(lv.dataset.ok!=="1"){lv.dataset.ok="1";lv.textContent=t.leader?"정말 해산할까요? 한 번 더 누르세요":"정말 나갈까요? 한 번 더 누르세요";return}
      call("POST","/api/mg/team/leave").then(function(r){if(r&&r.ok){D.teamOn=false;D.jointOn=false;draw(r)}})});box.appendChild(lv);
  }
  call("GET","/api/mg/team").then(function(r){if(!box.isConnected)return;if(!r||r._status!==200){box.innerHTML="";box.appendChild(el("p","app-empty","불러오지 못했어요."));return}draw(r)});
}

/* ── 4 정화의 노래 (리듬) ── */
var SG=null;
function songStop(){if(SG){SG.dead=true;cancelAnimationFrame(SG.raf);document.removeEventListener("keydown",SG.key,true);SG=null}}
function vSong(body){
  var c=card(body,"정화의 노래");
  note(c,"떨어지는 별이 선에 닿을 때 맞춰 누르면 정확도만큼 오염도가 줄어요. (정확도 100%면 -"+D.song.purge+") 하루 "+D.song.max+"번까지 · 시작하면 횟수가 줄어요.");
  var info=el("p","mgs-songi");c.appendChild(info);
  function inf(){info.innerHTML="";info.appendChild(el("span",null,"지금 오염도 "));info.appendChild(el("b",null,String(D.song.taint)));info.appendChild(el("span",null," · 오늘 남은 횟수 "));info.appendChild(el("b",null,D.song.left+" / "+D.song.max))}inf();
  var go=btn("mgs-go","♪ 노래 시작");c.appendChild(go);var msg=note(c,"");
  if(D.song.taint<=0){go.disabled=true;msg.textContent="오염도가 0이라 정화할 게 없어요."}else if(D.song.left<=0){go.disabled=true;msg.textContent="오늘은 모두 불렀어요. 내일 다시 와 주세요."}
  var stage=el("div","mgs-song");stage.hidden=true;c.appendChild(stage);
  go.addEventListener("click",function(){go.disabled=true;msg.textContent="";
    call("POST","/api/mg/song/start").then(function(r){
      if(!r||!r.ok){go.disabled=false;msg.textContent=r&&r.error==="no_plays"?"오늘은 모두 불렀어요.":r&&r.error==="clean"?"오염도가 0이라 정화할 게 없어요.":"시작하지 못했어요.";return}
      D.song.left=r.left;inf();play(r.notes,r.len);
    })});
  function play(notes,len){
    stage.hidden=false;stage.innerHTML="";go.hidden=true;
    var cv=el("canvas");cv.width=300;cv.height=320;stage.appendChild(cv);
    var pads=el("div","mgs-pads");["←  A","↓  S","→  D"].forEach(function(t,i){var b=btn("mgs-pad",t);b.addEventListener("pointerdown",function(e){e.preventDefault();hit(i)});pads.appendChild(b)});stage.appendChild(pads);
    var sc=el("p","mgs-score","준비…");stage.appendChild(sc);
    var k=cv.getContext("2d"),t0=performance.now(),j=notes.map(function(){return ""}),PER=90,GOOD=180,FALL=1400,HY=268,flashL=[0,0,0],pop=[];
    SG={dead:false,raf:0,key:function(e){var m={ArrowLeft:0,a:0,A:0,j:0,J:0,ArrowDown:1,s:1,S:1,k:1,K:1,ArrowRight:2,d:2,D:2,l:2,L:2}[e.key];if(m===undefined)return;e.preventDefault();e.stopPropagation();if(!e.repeat)hit(m)}};
    document.addEventListener("keydown",SG.key,true);
    function hit(l){var t=performance.now()-t0;flashL[l]=t;var best=-1,bd=1e9;notes.forEach(function(n,i){if(j[i]||n.l!==l)return;var d=Math.abs(n.t-t);if(d<bd){bd=d;best=i}});
      if(best>=0&&bd<=GOOD){j[best]=bd<=PER?"p":"g";pop.push({l:l,t:t,txt:bd<=PER?"반짝!":"좋아요"})}}
    function star5(x,y,r,col){k.fillStyle=col;k.beginPath();for(var i=0;i<10;i++){var rr=i%2?r*.45:r,a=i*Math.PI/5-Math.PI/2;k.lineTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr)}k.closePath();k.fill()}
    function frame(){if(!SG||SG.dead)return;var t=performance.now()-t0;
      var g=k.createLinearGradient(0,0,0,320);g.addColorStop(0,"#3b2650");g.addColorStop(1,"#7a4f8c");k.fillStyle=g;k.fillRect(0,0,300,320);
      for(var l=0;l<3;l++){var x=50+l*100;k.fillStyle="rgba(255,211,230,"+(t-flashL[l]<120?.28:.08)+")";k.fillRect(x-40,0,80,320)}
      k.strokeStyle="#ffd3e6";k.lineWidth=3;k.beginPath();k.moveTo(8,HY);k.lineTo(292,HY);k.stroke();
      for(l=0;l<3;l++){k.strokeStyle="rgba(255,255,255,.7)";k.lineWidth=2;k.beginPath();k.arc(50+l*100,HY,16,0,7);k.stroke()}
      notes.forEach(function(n,i){if(!j[i]&&t-n.t>GOOD)j[i]="m";if(j[i]&&j[i]!=="m")return;var dy=(n.t-t)/FALL;if(dy>1.05||dy<-.25)return;var y=HY-dy*HY;star5(50+n.l*100,y,13,j[i]==="m"?"rgba(180,150,190,.5)":["#ffd95e","#ff9cc6","#8cc8ff"][n.l])});
      pop=pop.filter(function(p){return t-p.t<500});pop.forEach(function(p){k.globalAlpha=1-(t-p.t)/500;k.fillStyle="#fff";k.font="bold 14px sans-serif";k.textAlign="center";k.fillText(p.txt,50+p.l*100,HY-30-(t-p.t)/20);k.globalAlpha=1});
      var p=j.filter(function(x){return x==="p"}).length,gd=j.filter(function(x){return x==="g"}).length;sc.textContent="반짝 "+p+" · 좋아요 "+gd+" · 놓침 "+j.filter(function(x){return x==="m"}).length+" / "+notes.length;
      if(t>=len){finish();return}SG.raf=requestAnimationFrame(frame)}
    SG.raf=requestAnimationFrame(frame);
    function finish(){var judge=j.map(function(x){return x||"m"}).join("");songStop();sc.textContent="정화하는 중…";
      call("POST","/api/mg/song/end",{judge:judge}).then(function(r){go.hidden=false;go.disabled=D.song.left<=0;
        if(!r||!r.ok){sc.textContent=r&&r.error==="too_fast"?"노래가 끝나기 전에 보냈어요. 다시 시도해 주세요.":"결과를 보내지 못했어요.";return}
        D.song.taint=r.taint;inf();sc.textContent="정확도 "+Math.round(r.acc*100)+"% · 오염도 -"+r.purge+" (지금 "+r.taint+")";toast("정화의 노래 · 오염도 -"+r.purge);if(window.pollState)window.pollState(false);
        if(D.song.taint<=0){go.disabled=true;msg.textContent="오염도를 모두 정화했어요!"}})}
  }
}

/* ── 5 별자리 잇기 ──
   판 배경: 커서와 이어지는 별자리 그물 · Lucian UX/UI Prompt #341 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#341
   떠다니는 점들이 가까워지면 옅은 선으로 이어집니다. (커서에는 반응하지 않고, 이어야 하는 별자리와 헷갈리지 않게 옅게) 왼쪽 위에 지금 이어진 선의 수. (별자리 판의 별·선은 그 위 캔버스에 그립니다) */
function net341(root,cv,ct,W,H){
  var cx=cv.getContext("2d"),rm=RM,dpr=Math.min(2,window.devicePixelRatio||1),LINK=72,PL=120,MAX=120;
  cv.width=W*dpr;cv.height=H*dpr;cx.scale(dpr,dpr);
  var P=[],ptr=null;
  function add(x,y,vx,vy,born){P.push({x:x,y:y,vx:vx,vy:vy,b:born||0});if(P.length>MAX)P.shift()}
  for(var i=0;i<72;i++)add(Math.random()*W,Math.random()*H,(Math.random()-.5)*22,(Math.random()-.5)*22);
  function draw(now){
    cx.clearRect(0,0,W,H);var links=0;
    for(var a=0;a<P.length;a++){for(var b=a+1;b<P.length;b++){var dx=P[a].x-P[b].x,dy=P[a].y-P[b].y;if(Math.abs(dx)>LINK||Math.abs(dy)>LINK)continue;var d=Math.hypot(dx,dy);if(d>LINK)continue;links++;
      var hue=210+(P[a].x/W)*90;cx.strokeStyle="hsla("+hue.toFixed(0)+",70%,80%,"+((1-d/LINK)*.16).toFixed(2)+")";cx.lineWidth=1;cx.beginPath();cx.moveTo(P[a].x,P[a].y);cx.lineTo(P[b].x,P[b].y);cx.stroke()}}
    if(ptr){P.forEach(function(p){var d=Math.hypot(p.x-ptr.x,p.y-ptr.y);if(d>PL)return;links++;cx.strokeStyle="rgba(255,224,130,"+((1-d/PL)*.8).toFixed(2)+")";cx.lineWidth=1.3;cx.beginPath();cx.moveTo(ptr.x,ptr.y);cx.lineTo(p.x,p.y);cx.stroke()});
      cx.fillStyle="#FFE082";cx.beginPath();cx.arc(ptr.x,ptr.y,3.5,0,6.2832);cx.fill()}
    P.forEach(function(p){var age=(now-p.b)/600,r=p.b&&age<1?1.2+(1-age)*1.8:1.2;cx.fillStyle="rgba(231,236,255,.38)";cx.beginPath();cx.arc(p.x,p.y,r,0,6.2832);cx.fill()});
    ct.textContent=links+" 연결";
  }
  var vis=true,raf=0,last=0;
  function frame(now){raf=0;if(!root.isConnected||!vis)return;var dt=Math.min(.05,Math.max(0,(now-last)/1000));last=now;
    P.forEach(function(p){if(ptr){var dx=ptr.x-p.x,dy=ptr.y-p.y,d=Math.hypot(dx,dy);if(d<PL&&d>12){p.vx+=dx/d*28*dt;p.vy+=dy/d*28*dt}}
      var sp=Math.hypot(p.vx,p.vy);if(sp>30){p.vx*=1-1.5*dt;p.vy*=1-1.5*dt}p.x+=p.vx*dt;p.y+=p.vy*dt;
      if(p.x<0||p.x>W){p.vx*=-1;p.x=Math.max(0,Math.min(W,p.x))}if(p.y<0||p.y>H){p.vy*=-1;p.y=Math.max(0,Math.min(H,p.y))}});
    draw(now);raf=requestAnimationFrame(frame)}
  function run(){if(rm){draw(performance.now());return}if(!raf&&vis){last=performance.now();raf=requestAnimationFrame(frame)}}
  if("IntersectionObserver" in window)new IntersectionObserver(function(es){vis=es[0].isIntersecting;run()}).observe(root);
  run();
  // 판 캔버스가 위에 있어서, 판에서 받은 포인터 위치를 그대로 넘겨받습니다
  return {move:function(q){ptr=q;if(rm)draw(performance.now())},leave:function(){ptr=null;if(rm)draw(performance.now())},
    burst:function(q){var now=performance.now();for(var k=0;k<9;k++){var a=k/9*Math.PI*2+Math.random()*.4,s=60+Math.random()*70;add(q.x,q.y,Math.cos(a)*s,Math.sin(a)*s,now)}if(rm)draw(now)}};
}
function vStar(body){
  var s=D.star,c=card(body,"오늘의 별자리 · "+s.ko);
  note(c,s.done?"완성했어요! 오늘 하루 "+s.txt+" 효과가 붙어 있어요.":"오른쪽 아래 그림처럼 별을 선으로 이어요. 별 하나를 누르고 다른 별을 누르면 선이 생기고, 같은 선을 다시 이으면 지워져요. 가짜 별도 3개 섞여 있어요. 완성하면 오늘 하루 "+s.txt+"!");
  var CW=34,PADX=24,PADY=24,Wd=PADX*2+CW*9,Hd=PADY*2+CW*6;
  var root=el("div","ux u341 mgs-sky");root.style.aspectRatio=Wd+" / "+Hd;c.appendChild(root);
  var ncv=el("canvas","u341-cv");ncv.setAttribute("aria-hidden","true");root.appendChild(ncv);
  var cv=el("canvas","mgs-board");cv.width=Wd;cv.height=Hd;cv.setAttribute("role","img");cv.setAttribute("aria-label","별자리 판, 별을 눌러 선으로 이어요");root.appendChild(cv);
  var ct=el("span","u341-ct");ct.setAttribute("aria-hidden","true");root.appendChild(ct);
  var NET=net341(root,ncv,ct,Wd,Hd);
  var k=cv.getContext("2d"),edges=[],selA=-1,done=s.done;
  var pos=function(st){return [PADX+st.x*CW,PADY+st.y*CW]};
  if(done)edges=s.hint.map(function(h){var a=s.stars.filter(function(x){return x.x===h[0][0]&&x.y===h[0][1]})[0],b=s.stars.filter(function(x){return x.x===h[1][0]&&x.y===h[1][1]})[0];return [a.id,b.id]});
  function sp(x,y,r,col){k.fillStyle=col;k.beginPath();k.moveTo(x,y-r);k.quadraticCurveTo(x,y,x+r,y);k.quadraticCurveTo(x,y,x,y+r);k.quadraticCurveTo(x,y,x-r,y);k.quadraticCurveTo(x,y,x,y-r);k.fill()}
  var HX=Wd-114,HY=Hd-84;
  function draw(){k.clearRect(0,0,Wd,Hd);
    // 힌트 (오른쪽 아래 작게 — 왼쪽 위에는 그물의 연결 수가 표시됨)
    k.save();k.fillStyle="rgba(10,13,31,.55)";k.fillRect(HX,HY,96,70);k.strokeStyle="#ffd3e6";k.lineWidth=1.5;
    s.hint.forEach(function(h){k.beginPath();k.moveTo(HX+6+h[0][0]*9,HY+6+h[0][1]*9);k.lineTo(HX+6+h[1][0]*9,HY+6+h[1][1]*9);k.stroke()});k.restore();
    k.lineWidth=2.5;k.strokeStyle=done?"#ffd95e":"#ff9cc6";k.shadowColor="#fff";k.shadowBlur=6;edges.forEach(function(e){var a=pos(s.stars[e[0]]),b=pos(s.stars[e[1]]);k.beginPath();k.moveTo(a[0],a[1]);k.lineTo(b[0],b[1]);k.stroke()});k.shadowBlur=0;
    s.stars.forEach(function(st,i){var p=pos(st);if(i===selA){k.strokeStyle="#ffd95e";k.lineWidth=2;k.beginPath();k.arc(p[0],p[1],11,0,7);k.stroke()}sp(p[0],p[1],7,done?"#ffe9a0":"#fff4fb")})}
  draw();
  function loc(e){var r=cv.getBoundingClientRect();return {x:(e.clientX-r.left)*Wd/r.width,y:(e.clientY-r.top)*Hd/r.height}}
  function starAt(x,y){var best=-1,bd=16*16;s.stars.forEach(function(st,i){var p=pos(st),d=(p[0]-x)*(p[0]-x)+(p[1]-y)*(p[1]-y);if(d<bd){bd=d;best=i}});return best}
  /* 배경 그물은 커서에 반응하지 않고 혼자 흘러갑니다 (이어야 하는 별자리와 헷갈리지 않게 옅게) */
  cv.addEventListener("click",function(e){if(done)return;var q=loc(e),i=starAt(q.x,q.y);if(i<0)return;
    if(selA<0||selA===i){selA=selA===i?-1:i;draw();return}
    var a=Math.min(selA,i),b=Math.max(selA,i),ix=edges.findIndex(function(z){return z[0]===a&&z[1]===b});if(ix>=0)edges.splice(ix,1);else edges.push([a,b]);selA=-1;draw()});
  var row=el("div","mgs-row");c.appendChild(row);var m=note(c,"");
  var clr=btn("mgs-ghost mgs-sm","모두 지우기",function(){edges=[];selA=-1;draw();m.textContent=""});var sub=btn("mgs-go mgs-sm","✦ 별자리 완성");row.appendChild(clr);row.appendChild(sub);
  if(done){clr.disabled=sub.disabled=true}
  sub.addEventListener("click",function(){sub.disabled=true;call("POST","/api/mg/star",{edges:edges}).then(function(r){sub.disabled=false;
    if(r&&r.ok){done=true;s.done=true;draw();clr.disabled=sub.disabled=true;m.textContent=r.ko+" 완성! 오늘 하루 "+r.txt+" 효과가 붙었어요.";toast("✦ "+r.ko+" 완성 · "+r.txt);if(window.pollState)window.pollState(false)}
    else if(r&&r.error==="done"){m.textContent="오늘은 이미 완성했어요."}
    else m.textContent=r&&r.need?"아직 아니에요. 맞는 선 "+r.right+" / "+r.need+" (틀린 선이 있으면 지워 주세요)":"확인하지 못했어요."})});
}

/* ═════════ 요정 도트 (26×28) · 우아한 파스텔 버전 ═════════
   h 머리 · s 피부 · e 눈 · b 볼 · d 옷 · D 옷 그늘 · a 장식 · w 지팡이 · 테두리 자동 · 날개는 왼쪽 절반만 그리고 좌우 대칭 (x = 반짝 점) */
var FAIRY=(function(){
  var W=26;
  function grid(rows){return rows.map(function(r){if(r.length>W)throw new Error('len '+r.length+' '+r);return (r+'..........................').slice(0,W)})}
  function mirror(rows){return rows.map(function(r){r=(r+'.............').slice(0,13);return r+r.split('').reverse().join('')})}
  return {
    lumi:{name:'루미',kind:'별빛 요정',line:'#a8784a',wingRim:'#f6c75e',wing:'#ffe89a',
      pal:{h:'#ffd877',s:'#fff0ee',e:'#6b3f2e',b:'#ffb7c3',d:'#fff6dc',D:'#f2cf86',a:'#ffe15e',w:'#d9b25a'},
      body:grid([
        '',
        '...........hhhh',
        '..........hhhhhh.......a',
        '.........hhhhhhhh.....aaa',
        '.........hssssssh......a',
        '.........hsessesh.....w',
        '.........hsbssbshh...w',
        '..........hssssh.hh.w',
        '..........h.ss..h.hss',
        '...........dddddsss',
        '..........sddddd',
        '.........s..dddd',
        '........s...dd',
        '........s..dddd',
        '...........dddd',
        '..........dddddd',
        '..........dddDdd',
        '.........dddDdddd',
        '.........ddDddDdd',
        '........dddDddDddd',
        '........ddDdddDddd',
        '.......dddDdddDdddd',
        '.......ddDddddDdddd',
        '......dddDdddddDdddd',
        '......ddDddddddDddddd',
        '.....dDdddddddddDdddd',
        '.....ddddddddddddddddd',
        '...........s..s']),
      wings:[mirror([
        '','','','',
        '..ww',
        '.wwww',
        '.wwwww',
        '.wwxwww',
        '..wwwwww',
        '...wwwwww',
        '....wwwww',
        '.....wwww',
        '....wwwww',
        '...wwxww',
        '...wwww',
        '....ww']),
      mirror([
        '','','','','','',
        '...ww',
        '..wwww',
        '..wwxww',
        '...wwwww',
        '....wwwww',
        '.....wwww',
        '....wwwww',
        '....wxww',
        '....www'])]},
    pio:{name:'피오',kind:'꽃잎 요정',line:'#b0587f',wingRim:'#f58db8',wing:'#ffc6e0',
      pal:{h:'#ffaed2',s:'#fff0ee',e:'#6b2f4a',b:'#ff9fbf',d:'#ffd0e4',D:'#f597bf',a:'#fff3a6',w:'#8fd17e'},
      body:grid([
        '',
        '..........a.aa.a',
        '..........awhhwa',
        '.........hhhhhhhh',
        '.........hssssssh',
        '.........hsessesh',
        '........hhsbssbshh',
        '........hh.ssss.hh',
        '............ss',
        '..........sdddds',
        '.........s.dddd.s',
        '.........s.daad.s',
        '..........ssaass',
        '...........dwwd',
        '..........ddDddd',
        '..........dddDdd',
        '.........dddDdddd',
        '.........ddDddDdd',
        '.........ddDddDdd',
        '........dddDddDddd',
        '........ddDddddDdd',
        '.........d.dddd.d',
        '...........s..s',
        '...........s..s',
        '..........ss..ss']),
      wings:[mirror([
        '','','','','',
        '...ww',
        '..wwww',
        '.wwwwww',
        '.wwxwww',
        '..wwwww',
        '...wwww',
        '....www',
        '....wwww',
        '...wwwww',
        '...wxwww',
        '....wwww',
        '.....ww']),
      mirror([
        '','','','','','',
        '....ww',
        '..wwwww',
        '..wwxww',
        '...wwww',
        '....www',
        '....wwww',
        '....wwww',
        '....wxww',
        '.....ww'])]},
    nea:{name:'네아',kind:'달빛 요정',line:'#5f5e9e',wingRim:'#9cc8f5',wing:'#cfe6ff',
      pal:{h:'#cfc8ff',s:'#fff0f2',e:'#3c3f78',b:'#ffbfd0',d:'#e2efff',D:'#aac6ee',a:'#fff3b8',w:'#fff'},
      body:grid([
        '...........aa',
        '..........a.hhh',
        '.........ahhhhhh',
        '.........hhhhhhhh',
        '.........hssssssh',
        '.........hsessesh',
        '........hhsbssbshh',
        '........hh.ssss.hh',
        '........hh..ss..hh',
        '........hDddddddDh',
        '........hDddddddDh',
        '........hhsddddshh',
        '........hh.ssss.hh',
        '........hhddddddhh',
        '.......hh.dddddd.hh',
        '.......hh.dddddd.hh',
        '.......h.dddddddd.h',
        '.......h.ddDddDdd.h',
        '........dddDddDddd',
        '........ddDddddDdd',
        '.......dddDddddDddd',
        '.......ddDddddddDdd',
        '......dddDddddddDddd',
        '......ddDddddddddDdd',
        '.....ddDddddddddddDdd',
        '.....ddddddddddddddddd']),
      wings:[mirror([
        '','','',
        'ww',
        'wwww',
        '.wwxww',
        '..wwwwww',
        '...wwwwww',
        '.....wwww',
        '',
        '.....wwww',
        '...wwwwww',
        '..wwwwww',
        '.wwxww',
        'wwww',
        'ww']),
      mirror([
        '','','','',
        '.www',
        '.wwwxw',
        '..wwwwwww',
        '....wwwwww',
        '',
        '',
        '....wwwwww',
        '..wwwwwww',
        '.wwxwww',
        '.www'])]}
  };
})();

/* 꼬마 마물 도트 (16×14) · m 몸 · d 그늘 · l 밝은 곳 · e 눈(1칸) · b 볼 · x 장식 · w 줄·손잡이 · 테두리 자동 */
var PETSP={
 sock:{c:{m:"#ff9fbf",d:"#e2709a",l:"#fff0f6",x:"#ffd95e",w:"#fff"},line:"#9a4466",g:[
  "....lllll.......",
  "....xxxxx.......",
  "....mmmmm.......",
  "....mmmmm.......",
  "....memem.......",
  "....bmmmb.......",
  "....mmmmm.......",
  "....xxxxxx......",
  "....mmmmmmmm....",
  "....mmmmmmmmm...",
  "....dmmmmmmmmm..",
  ".....dddddddd..."]},
 umbrella:{c:{m:"#8cc8ff",d:"#4f8fd6",l:"#e0f0ff",x:"#ffd95e",w:"#c49a6c"},line:"#33507a",g:[
  ".......x........",
  ".....mmlmm......",
  "...mmmmlmmmm....",
  "..mmmmmlmmmmm...",
  "..mmmemmmemmm...",
  ".mmmmbmmmbmmmm..",
  ".mdmmdmmmdmmdm..",
  ".d..d..w..d..d..",
  ".......w........",
  ".......w........",
  ".......w..w.....",
  "........ww......"]},
 pillow:{c:{m:"#efe6ff",d:"#b9a2ff",l:"#ffffff",x:"#ffd95e",w:"#fff"},line:"#5e4f8f",g:[
  "................",
  "..l.........l...",
  "..mmmmmmmmmmm...",
  ".mmmmmmmmmmmmm..",
  ".mmmemmmmmemmm..",
  ".mmmbmmmmmbmmm..",
  ".mmmmmmddmmmmm..",
  ".mmmmmmmmmmmmm..",
  ".ddmmmmmmmmmdd..",
  "..ddddddddddd...",
  "..l.........l..."]},
 key:{c:{m:"#ffd95e",d:"#d6a52e",l:"#fff4c4",x:"#ff9cc6",w:"#fff"},line:"#7a5a1e",g:[
  "...mmmm.........",
  "..mmmmmm........",
  ".mmemmemm.......",
  ".mmbmmbmm.......",
  ".mmmmmmmm.......",
  "..mmmmmm........",
  "...mmmm.........",
  "....mm..........",
  "....mm..........",
  "....mmdd........",
  "....mm..........",
  "....mmd.........",
  "....mm.........."]},
 candle:{c:{m:"#fff0e0",d:"#f2c39a",l:"#ffffff",x:"#ffb84d",w:"#ffe15e"},line:"#9a5a33",g:[
  "......w.........",
  ".....wxw........",
  ".....xxx........",
  "......d.........",
  "....mmmmm.......",
  "....lmmmm.......",
  "....memem.......",
  "....bmmmb.......",
  "....mmmmm.......",
  "....mmmdm.......",
  "....mmmmm.......",
  "...ddddddd......",
  "..ddddddddd....."]},
 balloon:{c:{m:"#ff9cc6",d:"#d9608f",l:"#ffe0ee",x:"#fff",w:"#c4a3b4"},line:"#8f4466",g:[
  "....mmmmm.......",
  "...mmmmllm......",
  "..mmmmmmllm.....",
  "..mmemmmemm.....",
  "..mmbmmmbmm.....",
  "..mmmmmmmmm.....",
  "...mmmmmmm......",
  "....mmmmm.......",
  "......d.........",
  "......w.........",
  ".......w........",
  "......w.........",
  ".......w........"]},
 teacup:{c:{m:"#e0f6ee",d:"#7fe0c0",l:"#ffffff",x:"#ffd95e",w:"#fff"},line:"#2f7a63",g:[
  "................",
  "................",
  ".lllll.llll.....",
  ".mmmmmmmmmmdd...",
  ".mmemmmmemm..d..",
  ".mmbmmmmbmm..d..",
  ".mmmmddmmmm.d...",
  "..mmmmmmmmdd....",
  "...mmmmmm.......",
  ".dddddddddd.....",
  "..dddddddd......"]},
 kite:{c:{m:"#ffd95e",d:"#f58dbb",l:"#fff4c4",x:"#8cc8ff",w:"#c4a3b4"},line:"#8f4466",g:[
  "......m.........",
  ".....mml........",
  "....mmmll.......",
  "...mmmmmll......",
  "..memmmmmel.....",
  "..dbmmmmmbd.....",
  "...ddmmmdd......",
  "....ddmdd.......",
  ".....ddd........",
  "......d.........",
  ".......x........",
  "......x.w.......",
  "........w.......",
  ".......w........"]}
};

function hexA(h,a){var n=parseInt(h.slice(1),16);return "rgba("+(n>>16)+","+(n>>8&255)+","+(n&255)+","+a+")"}
// 요정 그리기: 투명 바탕 28×31 캔버스 (CSS 로 정수 배율만)
function fairyDraw(cv,kind,fr,sil){
  var f=FAIRY[kind]||FAIRY.lumi,c=cv.getContext("2d"),B=f.body,Wg=f.wings[fr?1:0],h=B.length,ox=1,oy=1+(28-h)+(fr?1:0);
  c.clearRect(0,0,cv.width,cv.height);
  function on(g,x,y){return y>=0&&y<g.length&&x>=0&&x<26&&g[y][x]!=="."}
  function px(x,y,col){c.fillStyle=col;c.fillRect(ox+x,oy+y,1,1)}
  for(var y=0;y<Wg.length;y++)for(var x=0;x<26;x++){if(!on(Wg,x,y)||on(B,x,y))continue;var edge=!on(Wg,x,y-1)||!on(Wg,x,y+1)||!on(Wg,x-1,y)||!on(Wg,x+1,y);
    if(sil)px(x,y,edge?hexA("#c8b3ea",.55):hexA("#c8b3ea",.18));else if(Wg[y][x]==="x")px(x,y,"#ffffff");else if(edge)px(x,y,f.wingRim);else px(x,y,hexA(f.wing,(x+y)%3?.82:.6))}
  for(y=-1;y<=h;y++)for(x=-1;x<=26;x++){if(on(B,x,y))continue;if(on(B,x-1,y)||on(B,x+1,y)||on(B,x,y-1)||on(B,x,y+1))px(x,y,sil?"#3a2a52":f.line)}
  for(y=0;y<h;y++)for(x=0;x<26;x++){if(!on(B,x,y))continue;if(sil){px(x,y,!on(B,x,y-1)?"#9a84c4":"#4a3868");continue}px(x,y,f.pal[B[y][x]]||"#fff")}
}
var FY_CVS=[],FY_T=0,FY_FR=0;
function fairyCanvas(kind,cls,sil){
  var cv=el("canvas","mgs-fy"+(cls?" "+cls:""));cv.width=28;cv.height=31;cv.setAttribute("role","img");cv.setAttribute("aria-label",sil?"계약 전 요정 실루엣":(FAIRY[kind]?FAIRY[kind].kind+" "+FAIRY[kind].name:"요정"));
  var o={cv:cv,kind:kind,sil:!!sil};fairyDraw(cv,kind,0,sil);
  if(!RM){FY_CVS.push(o);if(!FY_T)FY_T=setInterval(function(){FY_FR^=1;FY_CVS=FY_CVS.filter(function(x){return document.body.contains(x.cv)||!x.started?(x.started=true,true):false});
    FY_CVS.forEach(function(x){if(document.body.contains(x.cv))fairyDraw(x.cv,x.kind,FY_FR,x.sil)});if(!FY_CVS.length){clearInterval(FY_T);FY_T=0}},430)}
  cv._fy=o;return cv;
}
function fairySet(cv,kind,sil){if(cv._fy){cv._fy.kind=kind;cv._fy.sil=!!sil}fairyDraw(cv,kind,FY_FR,sil)}

// 꼬마 마물 그리기 18×16 (몸 16칸)
function petDraw(cv,k,stage){
  var p=PETSP[k];if(!p)return;var c=cv.getContext("2d"),g=p.g.slice(),H=g.length;c.clearRect(0,0,cv.width,cv.height);
  if(k==="teacup"&&stage>=3)g[2]=".lllllxllll.....";      // 금빛 이음새
  var oy=16-H-1+(stage>=3?0:0);
  function body(ox,dim){function on(x,y){return y>=0&&y<H&&x>=0&&x<16&&g[y][x]!=="."}
    c.fillStyle=p.line;for(var y=-1;y<=H;y++)for(var x=-1;x<=16;x++){if(on(x,y))continue;if(on(x-1,y)||on(x+1,y)||on(x,y-1)||on(x,y+1))c.fillRect(ox+x,oy+y,1,1)}
    var pal=Object.assign({e:"#5b2c43",b:"#ffb3c4"},p.c);for(y=0;y<H;y++)for(x=0;x<16;x++){var ch=g[y][x];if(ch===".")continue;c.fillStyle=dim&&ch==="m"?p.c.d:(pal[ch]||"#fff");c.fillRect(ox+x,oy+y,1,1)}}
  if(k==="sock"&&stage>=3){body(-3,true);body(2,false)}else body(1,false);
  if(stage>=3){c.fillStyle="#ff6f9f";[[14,0],[16,0],[13,1],[14,1],[15,1],[16,1],[17,1],[14,2],[15,2],[16,2],[15,3]].forEach(function(q){c.fillRect(q[0],q[1],1,1)})}
}
function petCanvas(k,stage,sil){var cv=el("canvas","mgs-pet"+(sil?" sil":""));cv.width=18;cv.height=16;cv.setAttribute("role","img");cv.setAttribute("aria-label",sil?"아직 만나지 못한 꼬마 마물":"꼬마 마물");petDraw(cv,k,stage);return cv}

/* ═════════ 2차 묶음: 상태 (/api/state 의 mg) ═════════ */
var ST={letters:0,shoot:null,duel:0,mail:0,ribReq:0,els:[]};
function onState(mg,now){
  if(!mg){ST={letters:0,shoot:null,duel:0};shootSync(null);return}
  if(now)SH.skew=now-Date.now();
  ST.letters=mg.letters||0;ST.duel=mg.duel||0;ST.mail=mg.mail||0;ST.ribReq=mg.ribReq||0;ST.els=mg.els||[];MS.fairy=mg.fairy||null;
  (mg.wishPaid||[]).forEach(function(w){toast("✦ 소원 별똥별 보상 · "+w.n+"명이 함께 빌어서 골드 +"+w.gold+" · 경험치 +"+w.exp,5200)});
  shootSync(mg.shoot||null);
  if(MS.row)msUpdRow();
}

/* ═════════ 6 요정의 편지 (메신저 · 앱 '요정' 탭) ═════════ */
var MS={row:null,view:null};
function msDialog(){var m=document.getElementById("mmodal");return m&&m.querySelector(".dialog")}
function msRow(){
  if(!on())return null;
  var li=el("li","mgs-fyli"),b=el("button","mgs-fyrow");b.type="button";li.appendChild(b);MS.row=b;msUpdRow(true);
  b.addEventListener("click",function(){msOpen()});return li;
}
function msUpdRow(force){var b=MS.row;if(!b||(!force&&!document.body.contains(b)))return;
  var F=MS.fairy;b.innerHTML="";var av=el("span","mgs-fyav");av.appendChild(fairyCanvas(F?F.kind:"lumi","mgs-sm",!F));b.appendChild(av);
  var w=el("span","mgs-fytx");w.appendChild(el("b",null,F?"요정 "+F.ko:"요정이 기다리고 있어요"));w.appendChild(el("small",null,F?F.kindKo+" · 기분 "+F.moodKo:"눌러서 요정 3명 중 한 명과 계약해요"));b.appendChild(w);
  if(ST.letters){var bd=el("span","mbadge",String(ST.letters));b.appendChild(bd)}
  b.setAttribute("aria-label",(F?"요정 "+F.ko+" 편지함":"요정 계약하기")+(ST.letters?" (새 편지 "+ST.letters+"통)":""));
}
function msOpen(){
  var dlg=msDialog();if(!dlg)return;
  if(!MS.view){MS.view=el("div","mgs-w mgs-fv");MS.view.hidden=true;dlg.appendChild(MS.view)}
  document.getElementById("mlistv").hidden=true;document.getElementById("mchatv").hidden=true;MS.view.hidden=false;MS.view.innerHTML="";
  var hd=el("div","mgs-fvh");hd.appendChild(btn("hud-btn","← 목록",msBack));MS.view.appendChild(hd);
  var body=el("div","mgs-fvb");MS.view.appendChild(body);
  fairyPanel(body,{msg:true,head:hd});
  hd.querySelector("button").focus();
}
function msBack(){if(!MS.view||MS.view.hidden)return;MS.view.hidden=true;MS.view.innerHTML="";document.getElementById("mlistv").hidden=false;var x=document.getElementById("mclose");if(x)x.focus()}
function msReset(){if(MS.view&&!MS.view.hidden){MS.view.hidden=true;MS.view.innerHTML=""}}
document.addEventListener("keydown",function(e){if(e.key==="Escape"&&MS.view&&!MS.view.hidden){var m=document.getElementById("mmodal");if(m&&!m.hidden){e.stopPropagation();e.preventDefault();msBack()}}},true);

var KIND_TAG={lumi:"밝고 수다스러워요",pio:"수줍고 다정해요",nea:"조용하고 깊어요"};
function fairyPanel(host,o){
  o=o||{};host.innerHTML="";host.appendChild(el("p","app-empty","불러오는 중…"));
  call("GET","/api/mg/fairy?read=1").then(function(r){
    if(!host.isConnected)return;host.innerHTML="";
    if(!r||r._status!==200){host.appendChild(el("p","app-empty",r&&r.error==="event_off"?"마법소녀 이벤트가 끝났어요.":"불러오지 못했어요."));return}
    MS.fairy=r.fairy;ST.letters=0;msUpdRow();
    if(!r.fairy){contract(host,r,o);return}
    letters(host,r,o);
  });
}
function contract(host,r,o){
  var c=card(host,"요정과 계약하기");
  note(c,"요정 3명 중 한 명과 계약해요. 계약한 요정은 하루 한두 번 메신저로 편지를 보내요. 이벤트 동안에는 바꿀 수 없으니 신중히 골라 주세요.");
  var row=el("div","mgs-fyc");c.appendChild(row);var pick="",go=btn("mgs-go","요정을 골라 주세요");go.disabled=true;var m=note(c,"");
  r.kinds.forEach(function(k){var b=el("button","mgs-fyk");b.type="button";b.setAttribute("aria-pressed","false");
    var cv=fairyCanvas(k.k,"md",true);b.appendChild(cv);b.appendChild(el("b",null,"???"));b.appendChild(el("small",null,k.kind));
    b.addEventListener("click",function(){pick=k.k;go.dataset.ok="";Array.prototype.forEach.call(row.children,function(x){x.setAttribute("aria-pressed","false");fairySet(x.querySelector("canvas"),x._k,true);x.querySelector("b").textContent="???"});
      b.setAttribute("aria-pressed","true");fairySet(cv,k.k,false);b.querySelector("b").textContent=k.ko;go.disabled=false;go.textContent="✦ "+k.ko+"와(과) 계약하기";m.textContent=k.ko+" · "+k.kind+" — "+(k.tag||KIND_TAG[k.k])});
    b._k=k.k;row.appendChild(b)});
  c.appendChild(go);
  go.addEventListener("click",function(){if(!pick)return;if(go.dataset.ok!=="1"){go.dataset.ok="1";go.textContent="정말 계약할까요? 한 번 더 누르세요";return}
    go.disabled=true;call("POST","/api/mg/fairy/contract",{kind:pick}).then(function(q){if(q&&q.ok){toast("✦ 요정 "+q.fairy.ko+"와(과) 계약했어요!");fairyPanel(host,o)}else{go.disabled=false;m.textContent=q&&q.error==="has_fairy"?"이미 계약한 요정이 있어요.":"계약하지 못했어요."}})});
}
function fmtT(t){var d=new Date(t),z=function(n){return n<10?"0"+n:""+n};return (d.getMonth()+1)+"/"+d.getDate()+" "+z(d.getHours())+":"+z(d.getMinutes())}
function letters(host,r,o){
  var F=r.fairy;
  var top=el("div","mgs-fytop");top.appendChild(fairyCanvas(F.kind,"md"));var inf=el("div","mgs-fyinf");top.appendChild(inf);host.appendChild(top);
  function paintInf(){inf.innerHTML="";inf.appendChild(el("b",null,F.kindKo+" "+F.ko));
    var mood=el("p","mgs-fymood");mood.appendChild(el("span",null,"기분 "));mood.appendChild(el("b",null,F.moodKo+" ("+F.mood+")"));inf.appendChild(mood);
    var bar=el("div","mgs-bar");var i=el("i");i.style.width=F.bond+"%";bar.appendChild(i);var bl=el("small",null,"친밀도 "+F.bond+" / 100");inf.appendChild(bl);inf.appendChild(bar);
    inf.appendChild(el("small","mgs-fybon",F.bonusMin?"✦ 기분이 좋아서 다음 변신이 "+F.bonusMin+"분 더 길어요":"기분이 60 이상이면 다음 변신이 5분, 80 이상이면 10분 길어져요"))}
  paintInf();
  var ul=el("ul","mgs-lt");ul.setAttribute("role","log");ul.setAttribute("aria-label",F.ko+"의 편지");host.appendChild(ul);
  if(!r.letters.length)ul.appendChild(el("li","mgs-lt0","아직 편지가 없어요. 하루 한두 번(오전·저녁) 편지가 와요."));
  r.letters.forEach(function(l){
    var li=el("li","fy");li.appendChild(el("p",null,l.text));li.appendChild(el("small",null,F.ko+" · "+fmtT(l.at)));ul.appendChild(li);
    if(l.pick>=0){var me=el("li","me");me.appendChild(el("p",null,l.opts[l.pick]));ul.appendChild(me);if(l.react){var rc=el("li","fy");rc.appendChild(el("p",null,l.react));ul.appendChild(rc)}}
    else if(l.pick===-2)ul.appendChild(el("li","mgs-lt0","답장하지 못한 편지예요."));
    else{var op=el("li","mgs-opts");l.opts.forEach(function(t,i){op.appendChild(btn("mgs-opt",t,function(){
      Array.prototype.forEach.call(op.children,function(b){b.disabled=true});
      call("POST","/api/mg/fairy/reply",{id:l.id,pick:i}).then(function(q){if(!q||!q.ok){Array.prototype.forEach.call(op.children,function(b){b.disabled=false});toast(q&&q.error==="too_late"?"답장할 수 있는 시간이 지났어요.":"보내지 못했어요.");return}
        var me=el("li","me");me.appendChild(el("p",null,t));var rc=el("li","fy");rc.appendChild(el("p",null,q.react));op.replaceWith(me);me.insertAdjacentElement("afterend",rc);
        F=q.fairy;MS.fairy=F;paintInf();msUpdRow();if(q.delta>0)toast(F.ko+"의 기분이 좋아졌어요 (+"+q.delta+")");rc.scrollIntoView({block:"nearest"})})}))});ul.appendChild(op)}
  });
  note(host,"편지는 오전(10~13시)에 한 통, 저녁(18~22시)에 가끔 한 통 와요. 답장에 따라 요정의 기분과 친밀도가 바뀌고, 하루가 지나도록 답장하지 않으면 기분이 조금 내려가요.");
  setTimeout(function(){ul.scrollTop=ul.scrollHeight},0);
}
function vFairy(body){var b=el("div","mgs-fvb");body.appendChild(b);fairyPanel(b,{})}

/* ═════════ 7 마법 일기장 ═════════ */
var WD="일월화수목금토";
function dLabel(day){var d=new Date(day+"T00:00:00+09:00");return (d.getMonth()+1)+"월 "+d.getDate()+"일 ("+WD[(new Date(Date.parse(day+"T00:00:00Z"))).getUTCDay()]+")"}
function josa(w,a,b){var c=w.charCodeAt(w.length-1);return w+((c>=0xac00&&c<=0xd7a3&&(c-0xac00)%28)?a:b)}
function diaryLines(p){var L=[];
  if(p.kill)L.push("마물 "+p.kill+"마리를 정화했다."+(p.mons.length?" ("+p.mons.join(", ")+(p.kill>p.mons.length?" 등":"")+")":""));
  if(p.tf)L.push(p.tf+"번 변신했다.");
  if(p.song)L.push("정화의 노래를 "+p.song+"번 불렀다.");
  if(p.star)L.push("밤하늘에 "+josa(p.star,"을","를")+" 이었다.");
  if(p.wish)L.push("별똥별에 소원을 빌었다.");
  if(p.duel)L.push("연출 대결에서 "+p.duel+"번 이겼다.");
  if(p.pet)L.push("착해진 마물 ‘"+p.pet+"’이(가) 따라왔다.");
  if(p.friends)L.push(p.fnames.join(", ")+(p.friends>p.fnames.length?" 외 "+(p.friends-p.fnames.length)+"명":"")+"와(과) 이야기를 나눴다.");
  if(p.letters)L.push("요정에게 답장을 "+p.letters+"통 썼다.");
  return L}
function diaryView(host,r){
  host.innerHTML="";
  var cv=el("section","mgs-dcov");var h=el("div","mgs-dcovh");h.appendChild(el("b",null,"✦ "+r.owner+"의 마법 일기장"));cv.appendChild(h);
  var st=el("div","mgs-stamps");for(var i=0;i<Math.max(4,r.stamps+1);i++){var s=el("span",i<r.stamps?"on":"",i<r.stamps?"★":"");st.appendChild(s)}cv.appendChild(st);
  cv.appendChild(el("p","mgs-note","채운 날 "+r.filled+"일 · 반짝 도장 "+r.stamps+"개 · 다음 도장까지 "+r.next+"일"));
  var dots=el("div","mgs-ddots");for(i=0;i<r.per;i++)dots.appendChild(el("i",i<r.per-r.next?"on":""));cv.appendChild(dots);
  host.appendChild(cv);
  if(r.mine){var pr=el("label","mgs-pub");var cb=el("input");cb.type="checkbox";cb.checked=!!r.pub;pr.appendChild(cb);pr.appendChild(document.createTextNode(" 친구에게 일기장 보여 주기 (친구의 간단 프로필에서 볼 수 있어요)"));host.appendChild(pr);
    cb.addEventListener("change",function(){cb.disabled=true;call("POST","/api/mg/diary/pub",{on:cb.checked}).then(function(q){cb.disabled=false;if(q&&q.ok)toast(q.pub?"친구에게 일기장을 보여 줘요.":"일기장을 나만 봐요.");else cb.checked=!cb.checked})})}
  r.pages.forEach(function(p){var pg=el("article","mgs-page"+(p.today?" today":""));pg.appendChild(el("h5",null,dLabel(p.day)+(p.today?" · 오늘 (쓰는 중)":"")));
    var L=diaryLines(p);if(!L.length)pg.appendChild(el("p","mgs-note","오늘은 아직 비어 있어요. 변신하거나 마물을 정화하면 저절로 적혀요."));
    else{var ul=el("ul");L.forEach(function(t){ul.appendChild(el("li",null,t))});pg.appendChild(ul)}
    host.appendChild(pg)});
}
function vDiary(body){var b=el("div","mgs-diary");body.appendChild(b);b.appendChild(el("p","app-empty","불러오는 중…"));
  note(body,"하루 동안 한 일(정화한 마물, 변신, 노래, 별자리, 소원, 대결, 만난 친구, 요정 답장)이 저절로 일기 한 장에 정리돼요. 하루라도 무언가 한 날을 7일 채우면 표지에 반짝 도장을 찍어 줘요.");
  call("GET","/api/mg/diary").then(function(r){if(!b.isConnected)return;if(!r||r._status!==200){b.innerHTML="";b.appendChild(el("p","app-empty","불러오지 못했어요."));return}diaryView(b,r)})}
// 친구의 일기장 (간단 프로필 → 버튼)
function diaryDlg(code,name){
  var bd=el("div","mgs-dlg");var box=el("div","mgs-w mgs-dlgb");box.setAttribute("role","dialog");box.setAttribute("aria-modal","true");box.setAttribute("aria-label",name+"의 마법 일기장");bd.appendChild(box);
  var x=btn("mgs-ghost mgs-sm mgs-dlgx","닫기",close);box.appendChild(x);var b=el("div","mgs-diary");box.appendChild(b);b.appendChild(el("p","app-empty","불러오는 중…"));
  document.body.appendChild(bd);x.focus();
  function close(){bd.remove();document.removeEventListener("keydown",key,true)}
  function key(e){if(e.key==="Escape"){e.stopPropagation();e.preventDefault();close()}}
  document.addEventListener("keydown",key,true);bd.addEventListener("click",function(e){if(e.target===bd)close()});
  call("GET","/api/mg/diary?code="+encodeURIComponent(code)).then(function(r){if(!b.isConnected)return;if(!r||r._status!==200){b.innerHTML="";b.appendChild(el("p","app-empty",r&&r.error==="private"?"일기장을 공개하지 않았어요.":"불러오지 못했어요."));return}diaryView(b,r)});
}

/* ═════════ 8 소원 별똥별 (지구본 위 · 상단 알림) ═════════ */
var SH={cur:null,bar:null,star:null,raf:0,busy:false,done:false,n:0};
function shootSync(s){
  if(!s||!on()){shootEnd();return}
  if(SH.cur&&SH.cur.id===s.id){if(s.done)SH.done=true;return}
  shootEnd();SH.cur=s;SH.done=!!s.done;SH.n=0;
  var bar=el("div","mgs-w mgs-ssb");bar.setAttribute("role","status");
  var tx=el("span","mgs-ssbt");bar.appendChild(el("i","mgs-ssbi"));bar.appendChild(tx);var go=btn("mgs-go mgs-sm","✦ 소원 빌기",wish);bar.appendChild(go);document.body.appendChild(bar);
  SH.bar=bar;SH.tx=tx;SH.go=go;
  var host=document.getElementById("rwrap");
  if(host){var st=btn("mgs-ss","");st.setAttribute("aria-label","소원 별똥별, 눌러서 소원 빌기");st.appendChild(el("i"));st.addEventListener("click",wish);host.appendChild(st);SH.star=st}
  tick();
}
function snow(){return Date.now()+(SH.skew||0)}
function tick(){
  SH.raf=0;var s=SH.cur;if(!s)return;var n=snow();
  if(n>=s.end+500){shootEnd();return}
  var pre=n<s.start;
  SH.go.disabled=pre||SH.done||SH.busy;
  SH.tx.textContent=pre?"곧 소원 별똥별이 지나가요… "+Math.ceil((s.start-n)/1000)+"초":SH.done?"소원을 빌었어요! 지금까지 "+(SH.n||"여러")+"명 · 별똥별이 지나간 뒤 다 같이 보상을 받아요 · "+Math.ceil((s.end-n)/1000)+"초":"✦ 소원 별똥별이 지나가는 중! 지구본 위 별똥별을 눌러 소원을 빌어요 · "+Math.ceil((s.end-n)/1000)+"초";
  if(SH.star){var p=Math.max(0,Math.min(1,(n-s.start)/(s.end-s.start)));SH.star.hidden=pre;SH.star.classList.toggle("done",SH.done);
    var x=-8+p*112,y=18+Math.sin(p*Math.PI)*-10+p*46;SH.star.style.left=x+"%";SH.star.style.top=y+"%"}
  SH.raf=setTimeout(tick,RM?500:60);
}
function wish(){var s=SH.cur;if(!s||SH.done||SH.busy)return;SH.busy=true;
  call("POST","/api/mg/wish",{id:s.id}).then(function(r){SH.busy=false;
    if(r&&r.ok){SH.done=true;SH.n=r.n;if(SH.star){SH.star.classList.add("burst")}toast("✦ 소원을 빌었어요! 지금 "+r.n+"명 · 끝나면 골드 +"+r.reward.gold+" · 경험치 +"+r.reward.exp+" 이상",4200)}
    else toast(r&&r.error==="gone"?"별똥별이 이미 지나갔어요.":"소원을 빌지 못했어요.")})}
function shootEnd(){if(SH.raf)clearTimeout(SH.raf);SH.raf=0;if(SH.bar)SH.bar.remove();if(SH.star)SH.star.remove();SH.bar=SH.star=null;SH.cur=null}

/* ═════════ 9 마물을 친구로 (육성 앱 '마물 친구') ═════════ */
function petsView(wrap,back){
  wrap.innerHTML="";var w=el("div","mgs-w mgs-pets");wrap.appendChild(w);
  var hd=el("div","mgs-peth");hd.appendChild(btn("rai-back","← 목록",back));hd.appendChild(el("b",null,"✦ 마물 친구"));w.appendChild(hd);
  var box=el("div","mgs-petg");w.appendChild(box);box.appendChild(el("p","app-empty","불러오는 중…"));
  function load(){call("GET","/api/mg/pets").then(function(r){if(!box.isConnected)return;box.innerHTML="";
    if(!r||r._status!==200){box.appendChild(el("p","app-empty",r&&r.error==="event_off"?"마법소녀 이벤트가 끝났어요.":"불러오지 못했어요."));return}
    var skew=Date.now()-r.now,t0=Date.now();
    note(w.querySelector(".mgs-petn")||w,"");
    var own={};r.pets.forEach(function(p){own[p.k]=p});
    Object.keys(PETSP).forEach(function(k){var p=own[k],c=el("section","mgs-petc"+(p?"":" no")+(p&&p.done?" done":""));
      var st=el("div","mgs-pets0");st.appendChild(petCanvas(k,p?p.stage:0,!p));c.appendChild(st);
      var tx=el("div","mgs-pett");c.appendChild(tx);
      if(!p){tx.appendChild(el("b",null,"???"));tx.appendChild(el("small",null,"아직 만나지 못했어요"));box.appendChild(c);return}
      tx.appendChild(el("b",null,p.ko+(p.done?" ♥":"")));tx.appendChild(el("p",null,p.line));
      var bar=el("div","mgs-bar");var i=el("i");i.style.width=p.happy+"%";bar.appendChild(i);tx.appendChild(el("small",null,"행복 "+p.happy+" / 100"+(p.done?" · 이야기 완성!":"")));tx.appendChild(bar);
      if(!p.done){var row=el("div","mgs-row");[["pet","쓰다듬기 +"+r.act.pet.add,p.petIn],["play","놀아 주기 +"+r.act.play.add,p.playIn]].forEach(function(a){
        var b=btn("mgs-go mgs-sm",a[1]);if(a[2]>0){b.disabled=true;b.textContent=a[1].split(" ")[0]+" · "+hms(a[2])}
        b.addEventListener("click",function(){b.disabled=true;call("POST","/api/mg/pet/act",{k:k,act:a[0]}).then(function(q){
          if(q&&q.ok){if(q.reward)toast("♥ "+q.pet.ko+"의 이야기가 완성됐어요! 골드 +"+q.reward,5000);else if(q.pet.stage>q.before)toast("✦ "+q.pet.ko+": "+q.pet.line,4200);load()}
          else{toast(q&&q.error==="cooldown"?"조금 쉬었다가 다시 해 주세요.":"하지 못했어요.");load()}})});row.appendChild(b)});tx.appendChild(row)}
      box.appendChild(c)});
    var n=el("p","mgs-note mgs-petn","마물을 정화(토벌 성공)하면 낮은 확률로 ‘착해진 마물’이 따라와요. 쓰다듬기(1시간마다)와 놀아 주기(3시간마다)로 행복이 100이 되면 그 마물의 이야기가 완성되고 골드 +"+r.doneGold+"를 받아요. 그레이윅 우호 몬스터와는 따로 키워요.");box.appendChild(n);
  })}
  load();
}
function raiRow(onClick){if(!on())return null;var li=el("li");var b=btn("rai-mk mgs-raib","✦ 마물 친구",onClick);li.appendChild(b);return li}

/* ═════════ 10 마법소녀 연출 대결 (전장 앱) ═════════ */
var DK={l:"빛",r:"리본",s:"노래"},DI={l:"M12 2C12 8 16 12 22 12C16 12 12 16 12 22C12 16 8 12 2 12C8 12 12 8 12 2Z",r:"M12 12L3 6.5V17.5ZM12 12L21 6.5V17.5ZM12 9.6A2.4 2.4 0 1 1 11.99 9.6Z",s:"M9 18a3 3 0 1 1-2-2.83V5l12-2.2v11.4a3 3 0 1 1-2-2.83V5.6L9 7.1Z"};
function dIcon(k,cls){var s=document.createElementNS("http://www.w3.org/2000/svg","svg");s.setAttribute("viewBox","0 0 24 24");s.setAttribute("class","mgs-di "+k+(cls?" "+cls:""));s.setAttribute("aria-hidden","true");var p=document.createElementNS("http://www.w3.org/2000/svg","path");p.setAttribute("d",DI[k]);s.appendChild(p);return s}
function pvpEntry(w,open){if(!on())return;var c=el("div","mgs-w mgs-pve");var b=btn("mgs-go","✦ 마법소녀 연출 대결",open);c.appendChild(b);c.appendChild(el("small",null,"빛·리본·노래로 겨루는 가벼운 대결 · 체력이나 패배 불이익 없음"+(ST.duel?" · 새 소식 "+ST.duel:"")));w.appendChild(c)}
var DUELT=0;
function duelView(w,back){
  clearInterval(DUELT);w.textContent="";w.className="pvp-w";
  var root=el("div","mgs-w mgs-duel");w.appendChild(root);
  var hd=el("div","mgs-peth");hd.appendChild(btn("mgs-ghost mgs-sm","← 전장",function(){clearInterval(DUELT);back()}));hd.appendChild(el("b",null,"✦ 마법소녀 연출 대결"));root.appendChild(hd);
  note(root,"빛은 리본을, 리본은 노래를, 노래는 빛을 이겨요. 3턴 동안 하나씩 미리 골라 두면 상대가 나타나는 순간 겨뤄요. 이긴 쪽은 진 쪽 코스튬 부품 하나를 구경하는 ‘반짝 카드’를 받아요. 체력·패배 불이익 없음 · 하루 10번.");
  var stage=el("div","mgs-dstage");stage.hidden=true;root.appendChild(stage);
  var pc=card(root,"내 3턴 연출");var picks=["l","r","s"];var prow=el("div","mgs-dpick");pc.appendChild(prow);
  [0,1,2].forEach(function(t){var col=el("div","mgs-dcol");col.appendChild(el("small",null,(t+1)+"턴"));["l","r","s"].forEach(function(k){var b=el("button","mgs-dbtn");b.type="button";b.appendChild(dIcon(k));b.appendChild(el("span",null,DK[k]));b.setAttribute("aria-pressed",picks[t]===k?"true":"false");b.setAttribute("aria-label",(t+1)+"턴 "+DK[k]);
    b.addEventListener("click",function(){picks[t]=k;Array.prototype.forEach.call(col.querySelectorAll("button"),function(x){x.setAttribute("aria-pressed","false")});b.setAttribute("aria-pressed","true")});col.appendChild(b)});prow.appendChild(col)});
  var act=el("div","mgs-row");pc.appendChild(act);var qb=btn("mgs-go mgs-sm","랜덤 상대 찾기");act.appendChild(qb);
  var f=el("form","mgs-form");var ti=el("input");ti.type="text";ti.maxLength=40;ti.placeholder="친구 닉네임 또는 코드";ti.setAttribute("aria-label","대결을 신청할 친구");f.appendChild(ti);var ib=el("button","mgs-ghost mgs-sm","친구에게 신청");ib.type="submit";f.appendChild(ib);pc.appendChild(f);
  var msg=note(pc,"");var left=el("small","mgs-lab");pc.appendChild(left);
  var stc=el("div");root.appendChild(stc);var recC=card(root,"최근 대결");var cardC=card(root,"반짝 카드");
  var ERR={busy:"이미 기다리는 대결이 있어요. 취소하거나 끝난 뒤에 다시 해 주세요.",no_plays:"오늘 대결을 모두 했어요.",no_user:"그런 헌터를 찾을 수 없어요.",not_friend:"친구에게만 신청할 수 있어요.",self:"자기 자신에게는 신청할 수 없어요.",gone:"신청이 끝났거나 취소됐어요.",rate_limited:"잠시 뒤에 다시 해 주세요."};
  var D2=null,played={};
  function paint(r){D2=r;left.textContent="오늘 남은 대결 "+r.left+" / "+r.max;qb.disabled=ib.disabled=!!r.open||r.left<=0;
    stc.innerHTML="";
    if(r.open){var c=card(stc,null);var t=el("div","mgs-inv");t.appendChild(el("span",null,(r.open.st==="wait"?"랜덤 상대를 기다리는 중":r.open.to+" 님의 응답을 기다리는 중")+" · 내 연출 "));
      var ic=el("span","mgs-dmini");Array.from(r.open.picks).forEach(function(k){ic.appendChild(dIcon(k))});t.appendChild(ic);
      t.appendChild(btn("mgs-ghost mgs-sm","취소",function(){call("POST","/api/mg/duel/cancel").then(function(q){if(q&&q.ok)paint(q)})}));c.appendChild(t)}
    if(r.invites.length){var ci=card(stc,"받은 대결 신청");r.invites.forEach(function(i){var row=el("div","mgs-inv");row.appendChild(el("span",null,i.from+" 님 · 위에서 고른 내 연출로 받아요"));
      row.appendChild(btn("mgs-go mgs-sm","받기",function(){call("POST","/api/mg/duel/answer",{id:i.id,picks:picks.join("")}).then(function(q){if(q&&q.ok){paint(q);if(q.duel)reveal(q.duel)}else toast(ERR[q&&q.error]||"처리하지 못했어요.")})}));
      row.appendChild(btn("mgs-ghost mgs-sm","거절",function(){call("POST","/api/mg/duel/answer",{id:i.id,decline:true}).then(function(q){if(q&&q.ok)paint(q)})}));ci.appendChild(row)})}
    recC.querySelectorAll(":scope > :not(h4)").forEach(function(x){x.remove()});
    if(!r.recent.length)recC.appendChild(el("p","mgs-note","아직 대결 기록이 없어요."));
    var ul=el("ul","mgs-drec");r.recent.forEach(function(x){var li=el("li",x.res);li.appendChild(el("b",null,x.res==="win"?"승리":x.res==="lose"?"패배":x.res==="draw"?"무승부":"거절"));
      li.appendChild(el("span",null,"vs "+x.vs));if(x.st==="done"){var m=el("span","mgs-dmini");Array.from(x.mine||"").forEach(function(k){m.appendChild(dIcon(k))});m.appendChild(document.createTextNode(" : "));Array.from(x.theirs||"").forEach(function(k){m.appendChild(dIcon(k))});li.appendChild(m)}
      ul.appendChild(li);if(x.fresh&&x.st==="done"&&!played[x.id]){played[x.id]=1;reveal(x)}});recC.appendChild(ul);
    cardC.querySelectorAll(":scope > :not(h4)").forEach(function(x){x.remove()});
    if(!r.cards.length)cardC.appendChild(el("p","mgs-note","대결에서 이기면 상대 코스튬 부품 하나를 구경하는 카드가 생겨요."));
    var g=el("div","mgs-cards");r.cards.forEach(function(c){var d=el("div","mgs-card2");d.appendChild(el("small",null,PART_KO[c.k]));d.appendChild(el("b",null,c.ko));d.appendChild(el("span",null,c.from+" 님의 코스튬"));
      var me=Object.assign({r:"bow",s:"pants",c:"sakura",w:"star"},r.cos||{});me[c.k]=c.v;d.appendChild(cosTag(me));d.title="내 코스튬에 이 부품을 대 보면";g.appendChild(d)});cardC.appendChild(g);
  }
  function reveal(x){
    stage.hidden=false;stage.innerHTML="";var rows=el("div","mgs-dturns");stage.appendChild(el("p","mgs-dvs","나  vs  "+x.vs));stage.appendChild(rows);var fin=el("p","mgs-dfin");stage.appendChild(fin);
    var mine=Array.from(x.mine),th=Array.from(x.theirs),sa=0,sb=0,BEAT={l:"r",r:"s",s:"l"};
    stage.scrollIntoView({block:"nearest",behavior:RM?"auto":"smooth"});
    mine.forEach(function(k,i){setTimeout(function(){var y=th[i],res=BEAT[k]===y?"w":BEAT[y]===k?"l":"d";if(res==="w")sa++;else if(res==="l")sb++;
      var row=el("div","mgs-dturn "+res);row.appendChild(el("small",null,(i+1)+"턴"));row.appendChild(dIcon(k,res==="w"?"big win":"big"));row.appendChild(el("b",null,res==="w"?"이겼다!":res==="l"?"졌다":"비김"));row.appendChild(dIcon(y,res==="l"?"big win":"big"));rows.appendChild(row);
      if(i===2)setTimeout(function(){fin.textContent=(x.res==="win"?"✦ 승리! ":x.res==="lose"?"아쉽게 졌어요. ":"무승부! ")+sa+" : "+sb+(x.card?" · 반짝 카드 획득: "+x.card.from+" 님의 "+x.card.ko+" ("+PART_KO[x.card.k]+")":"");fin.className="mgs-dfin "+x.res},RM?0:500)},RM?0:700*(i+1))});
  }
  function load(){call("GET","/api/mg/duel").then(function(r){if(!root.isConnected){clearInterval(DUELT);return}if(r&&r._status===200)paint(r);else if(r&&r.error==="event_off")msg.textContent="마법소녀 이벤트가 끝났어요."})}
  qb.addEventListener("click",function(){qb.disabled=true;msg.textContent="";call("POST","/api/mg/duel/queue",{picks:picks.join("")}).then(function(q){if(!q||!q.ok){qb.disabled=false;msg.textContent=ERR[q&&q.error]||"신청하지 못했어요.";return}
    paint(q);if(q.matched&&q.duel){played[q.duel.id]=1;reveal(q.duel)}else msg.textContent="상대를 기다리고 있어요. 다른 헌터가 대결을 찾으면 바로 겨뤄요. (이 화면을 닫아도 돼요)"})});
  f.addEventListener("submit",function(e){e.preventDefault();var t=ti.value.trim();if(!t)return;ib.disabled=true;msg.textContent="";call("POST","/api/mg/duel/invite",{target:t,picks:picks.join("")}).then(function(q){if(!q||!q.ok){ib.disabled=false;msg.textContent=ERR[q&&q.error]||"신청하지 못했어요.";return}msg.textContent=q.to+" 님에게 대결을 신청했어요.";ti.value="";paint(q)})});
  load();DUELT=setInterval(function(){if(document.hidden)return;load()},6000);
}

/* ═════════════ 3차 묶음 ═════════════ */
Object.assign(COS_KO.r,{tiara:"거울 티아라",bunny:"토끼 귀"});Object.assign(COS_KO.s,{moon:"달빛 드레스"});Object.assign(COS_KO.c,{midnight:"한밤",ruby:"적월"});Object.assign(COS_KO.w,{mirror:"손거울"});
Object.assign(COS_COL,{midnight:"#4a3a8c",ruby:"#c8324a"});
function fmtD(t){var d=new Date(t),z=function(n){return n<10?"0"+n:""+n};return (d.getMonth()+1)+"/"+d.getDate()+" "+z(d.getHours())+":"+z(d.getMinutes())}
function leftTxt(ms){var h=Math.floor(ms/3600000),d=Math.floor(h/24);return d?d+"일 "+(h%24)+"시간":h+"시간 "+Math.floor(ms%3600000/60000)+"분"}

/* ═════════ 11 마법 학교 수업 (기기 앱 '마법 학교') ═════════ */
var SUBJ_IC={fly:"🪄",potion:"⚗",star:"✦",care:"♥"};
function school(scr){
  var w=el("div","mgs-w mgs-sch");scr.appendChild(w);w.appendChild(el("p","app-empty","불러오는 중…"));
  call("GET","/api/mg/school").then(function(r){if(!w.isConnected)return;w.innerHTML="";
    if(!r||r._status!==200){w.appendChild(el("p","app-empty",r&&r.error==="event_off"?"마법소녀 이벤트가 끝났어요.":"불러오지 못했어요."));return}
    if(r.fresh)toast("✦ "+r.subj.ko+" 수료! 수료증을 받았어요."+(r.grad?" 마법 학교를 졸업했어요 · 칭호 ‘마법 학교 졸업생’":""),5200);
    var hd=el("div","mgs-schh");hd.appendChild(el("small",null,"STARLIGHT MAGIC ACADEMY"));hd.appendChild(el("b",null,"마법 학교 · "+r.week+"주차"));
    hd.appendChild(el("span",null,"수료 "+r.certs+" / "+r.total+(r.graduated?" · 졸업 ✦":"")));w.appendChild(hd);
    var S=r.subj,c=card(w,null);c.classList.add("mgs-schnow");
    var t=el("div","mgs-scht");t.appendChild(el("i",null,SUBJ_IC[S.k]||"✦"));var tt=el("div");tt.appendChild(el("b",null,"이번 주 과목 · "+S.ko));tt.appendChild(el("small",null,S.desc+" · 남은 시간 "+leftTxt(r.weekEnd-r.now)));t.appendChild(tt);c.appendChild(t);
    var ul=el("ul","mgs-schl");S.tasks.forEach(function(x){var li=el("li",x.n>=x.need?"ok":"");var top=el("div");top.appendChild(el("span",null,(x.n>=x.need?"✓ ":"")+x.ko));top.appendChild(el("b",null,x.n+" / "+x.need));li.appendChild(top);
      var bar=el("div","mgs-bar");var i=el("i");i.style.width=Math.round(x.n/x.need*100)+"%";bar.appendChild(i);li.appendChild(bar);ul.appendChild(li)});c.appendChild(ul);
    if(S.done){var cert=el("div","mgs-cert");cert.appendChild(el("small",null,"CERTIFICATE"));cert.appendChild(el("b",null,"수 료 증"));cert.appendChild(el("p",null,"위 헌터는 마법 학교 ‘"+S.ko+"’ 과정을 성실히 마쳤기에 이 증서를 드립니다."));cert.appendChild(el("span","mgs-seal","✦"));c.appendChild(cert)}
    else note(c,"세 가지를 모두 채우면 수료증을 받아요. 활동은 이번 주(월요일 0시 ~ 일요일 24시) 기록만 세요.");
    var g=card(w,"전체 과목 (4과목을 모두 수료하면 졸업 칭호)");var gr=el("div","mgs-schg");
    r.subjects.forEach(function(x){var d=el("div","mgs-schs"+(x.cert?" ok":"")+(x.now?" now":""));d.appendChild(el("i",null,SUBJ_IC[x.k]||"✦"));d.appendChild(el("b",null,x.ko));
      d.appendChild(el("small",null,x.cert?"수료 ✓ ("+x.cert.week.slice(5).replace("-","/")+" 주)":x.now?"이번 주 수업":"다른 주에 열려요"));d.appendChild(el("span",null,x.tasks.join(" · ")));gr.appendChild(d)});g.appendChild(gr);
    if(r.graduated){var gb=el("p","mgs-grad","🎓 졸업 축하해요! 칭호 ‘마법 학교 졸업생’은 업적 앱의 칭호에서 달 수 있어요.");w.appendChild(gb)}
    else note(w,"과목은 이벤트를 켠 주부터 비행 → 물약 → 별 읽기 → 마물 돌봄 순서로 한 주에 하나씩 열리고, 4주가 지나면 다시 돌아와요. 놓친 과목은 다음 바퀴에 수료할 수 있어요.");
  });
}

/* ═════════ 12 거울 나라의 나 ═════════ */
function vMirror(body){
  var box=el("div","mgs-mir");body.appendChild(box);box.appendChild(el("p","app-empty","불러오는 중…"));
  var KO={no_stats:"먼저 전장 앱에서 PVP 스탯을 배분해 주세요.",no_tries:"이번 주 도전을 모두 썼어요. 다음 주에 다시 나타나요.",won:"이번 주 거울 속 나는 이미 쓰러뜨렸어요.",no_shards:"거울 조각이 모자라요.",owned:"이미 산 부품이에요.",rate_limited:"잠시 뒤에 다시 해 주세요.",no_fight:"전투가 끝났어요.",busy:"잠시 뒤에 다시 골라 주세요."};
  var ACT=[["attack","공격","기본 공격"],["smash","강타","성공하면 피해 2배 (60%)"],["guard","방어","받는 피해 크게 줄임"],["flee","도주","성공하면 전투 포기 (패배)"]];
  var FOE={attack:"공격",smash:"강타",guard:"방어",flee:"도주"};
  function draw(r,res){box.innerHTML="";
    var c=card(box,"거울 나라의 나");note(c,"‘거울 속 나’가 한 주에 한 번 나타나요. 한 주에 "+r.max+"번까지 도전할 수 있고, 쓰러뜨리면 거울 조각 "+r.reward+"개. 전장 체력은 줄지 않아요.");
    if(r.fight){fight(c,r.fight,[["거울 속 나와 마주했어요. 행동을 골라 주세요.","en"]]);}
    else{
      var row=el("div","mgs-row");var go=btn("mgs-go mgs-sm",r.won?"이번 주 승리 ✦":"거울 속으로 들어가기 ("+(r.max-r.tries)+"번 남음)");go.disabled=r.won||r.tries>=r.max||!r.set;row.appendChild(go);c.appendChild(row);
      var m=note(c,!r.set?KO.no_stats:r.won?"다음 주 월요일에 새 거울이 나타나요 ("+leftTxt(r.weekEnd-Date.now())+" 뒤).":"");
      go.addEventListener("click",function(){go.disabled=true;call("POST","/api/mg/mirror/fight").then(function(q){if(!q||!q.ok){go.disabled=false;m.textContent=KO[q&&q.error]||"들어가지 못했어요.";return}draw(q)})});
      if(res){var rs=el("p","mgs-mirres "+(res.win?"win":"lose"),res.win?"✦ 거울 속 나를 쓰러뜨렸어요! 거울 조각 +"+r.reward+(res.title?" · 칭호 ‘거울을 넘은 자’":""):(res.kind==="flee"?"거울에서 빠져나왔어요. ":"거울 속 나에게 졌어요. ")+(r.max-r.tries>0?"다시 도전할 수 있어요.":"다음 주에 다시 나타나요."));c.insertBefore(rs,row)}
    }
    var sc=card(box,"거울 상점 · 가진 조각 "+r.shards+"개");note(sc,"산 부품은 코스튬 탭에서 고를 수 있어요. (지금까지 거울을 넘은 횟수 "+r.wins+"번 · "+r.titleNeed+"번이면 칭호)");
    var g=el("div","mgs-shop");r.shop.forEach(function(p){var d=el("div","mgs-shopi"+(p.own?" own":""));d.appendChild(el("small",null,PART_KO[p.k]));d.appendChild(el("b",null,p.ko));
      var b=btn("mgs-go mgs-sm",p.own?"가지고 있어요":"조각 "+p.cost+"개");b.disabled=p.own||r.shards<p.cost;b.addEventListener("click",function(){b.disabled=true;call("POST","/api/mg/mirror/buy",{k:p.k,v:p.v}).then(function(q){if(q&&q.ok){toast("✦ "+q.bought+"을(를) 샀어요! 코스튬 탭에서 골라 보세요.");if(D&&D.shop)D.shop=q.shop;draw(q)}else{b.disabled=false;toast(KO[q&&q.error]||"사지 못했어요.")}})});d.appendChild(b);g.appendChild(d)});sc.appendChild(g);
  }
  function fight(c,f,first){var mx=f.max,st=el("div","mgs-mirb");c.appendChild(st);
    function bar(lab){var w=el("div","mgs-hpw");w.appendChild(el("small",null,lab));var o=el("div","mgs-hp");var i=el("i");o.appendChild(i);w.appendChild(o);var v=el("b",null,mx+"");w.appendChild(v);st.appendChild(w);return function(h){i.style.width=Math.max(0,h/mx*100)+"%";v.textContent=Math.max(0,Math.round(h))+""}}
    var A=bar("나"),B=bar("거울 속 나");A(f.hp[0]);B(f.hp[1]);
    var tn=el("p","mgs-mirtn","");st.appendChild(tn);
    var lg=el("div","mgs-mirlog");lg.setAttribute("aria-live","polite");st.appendChild(lg);
    function turnTxt(t){tn.textContent=(t+1)+"턴 · 최대 "+(f.maxTurns||40)+"턴 (끝까지 가면 체력이 많은 쪽 승리)"}
    function log(lines){lines.forEach(function(l){var p=el("p",l[1]?"k-"+l[1]:null,l[0]);lg.appendChild(p)});while(lg.children.length>8)lg.removeChild(lg.firstChild);lg.scrollTop=lg.scrollHeight}
    turnTxt(f.turn);log(first);
    var acts=el("div","mgs-miracts");st.appendChild(acts);var bs=[];
    ACT.forEach(function(a){var b=btn("mgs-mira"+(a[0]==="flee"?" flee":""),"");b.appendChild(el("b",null,a[1]));b.appendChild(el("small",null,a[2]));b.addEventListener("click",function(){
      if(a[0]==="flee"&&!confirmFlee(b))return;
      bs.forEach(function(x){x.disabled=true});
      call("POST","/api/mg/mirror/act",{act:a[0]}).then(function(q){
        if(!q||!q.ok){bs.forEach(function(x){x.disabled=false});if(q&&q.error==="no_fight"){reload();return}toast(KO[q&&q.error]||"행동하지 못했어요.");return}
        log([["— "+q.turn+"턴: 나 "+a[1]+" · 거울 속 나 "+(FOE[q.foe]||"")+" —",""]].concat(q.lines));A(q.hp[0]);B(q.hp[1]);
        if(q.over){setTimeout(function(){if(box.isConnected){draw(q,q);var mm=box.querySelector(".mgs-mirres");if(mm)mm.scrollIntoView({block:"nearest"})}},RM?0:900);return}
        turnTxt(q.turn);bs.forEach(function(x){x.disabled=false});
      })});bs.push(b);acts.appendChild(b)});
  }
  function confirmFlee(b){if(b._ok)return true;b._ok=true;var s=b.querySelector("small");var o=s.textContent;s.textContent="한 번 더 누르면 도주 (도전 1번 소모)";setTimeout(function(){b._ok=false;s.textContent=o},3000);return false}
  function reload(){call("GET","/api/mg/mirror").then(function(r){if(!box.isConnected)return;if(!r||r._status!==200){box.innerHTML="";box.appendChild(el("p","app-empty","불러오지 못했어요."));return}draw(r)})}
  reload();
}

/* ═════════ 13 반짝 우체통 ═════════ */
function vMail(body){
  var box=el("div","mgs-mail");body.appendChild(box);box.appendChild(el("p","app-empty","불러오는 중…"));
  var KO={blocked:"운영자에 의해 메시지 전송이 제한되었어요.",no_mail:"오늘은 편지를 모두 보냈어요. (하루 3통)",no_user:"그런 헌터를 찾을 수 없어요.",ambiguous:"같은 닉네임이 여럿이에요. 코드로 보내 주세요.",self:"나에게는 보낼 수 없어요.",bad_text:"편지는 1~50자로 적어 주세요.",rate_limited:"잠시 뒤에 다시 보내 주세요."};
  function draw(r){box.innerHTML="";
    var hd=el("div","mgs-mbox");var hb=el("div","mgs-heart");hb.appendChild(el("b",null,String(r.inbox.length)));hb.appendChild(el("small",null,"통"));hd.appendChild(hb);
    var ht=el("div");ht.appendChild(el("b",null,"반짝 우체통"));ht.appendChild(el("p","mgs-note","이름을 밝히지 않고 아무 헌터에게나 짧은 응원 편지를 보내요. 받은 편지는 하트 우체통에 쌓여요."));hd.appendChild(ht);box.appendChild(hd);
    var c=card(box,"응원 편지 쓰기 · 오늘 "+r.left+" / "+r.max+"통");
    var f=el("form","mgs-mailf");var to=el("input");to.type="text";to.maxLength=40;to.placeholder="받을 헌터 닉네임 또는 코드";to.setAttribute("aria-label","받을 헌터");
    var rl=el("label","mgs-pub");var rc=el("input");rc.type="checkbox";rl.appendChild(rc);rl.appendChild(document.createTextNode(" 아무 헌터에게나 (무작위)"));
    rc.addEventListener("change",function(){to.disabled=rc.checked});
    var ta=el("textarea");ta.maxLength=80;ta.rows=2;ta.placeholder="예) 오늘도 수고했어요! 붉은 달 아래 당신을 응원해요.";ta.setAttribute("aria-label","응원 편지 (50자)");
    var cnt=el("small","mgs-cnt");var sb=el("button","mgs-go mgs-sm","✉ 몰래 보내기");sb.type="submit";sb.disabled=r.left<=0;
    function cc(){var n=Array.from(ta.value.trim()).length;cnt.textContent=n+" / "+r.len;cnt.classList.toggle("over",n>r.len)}ta.addEventListener("input",cc);cc();
    [to,rl,ta].forEach(function(x){f.appendChild(x)});var fr=el("div","mgs-row");fr.appendChild(cnt);fr.appendChild(sb);f.appendChild(fr);c.appendChild(f);var m=note(c,"보낸 사람 이름은 받는 사람에게 보이지 않아요. 메신저와 같은 규칙으로 검열돼요.");
    f.addEventListener("submit",function(e){e.preventDefault();var t=ta.value.trim();if(!t||Array.from(t).length>r.len){m.textContent=KO.bad_text;return}if(!rc.checked&&!to.value.trim()){m.textContent="받을 헌터를 적거나 ‘아무 헌터에게나’를 골라 주세요.";return}
      sb.disabled=true;call("POST","/api/mg/mail",{text:t,target:to.value.trim(),random:rc.checked}).then(function(q){if(q&&q.ok){toast(q.to?q.to+" 님에게 몰래 응원 편지를 보냈어요 ✉":"어느 헌터에게 몰래 응원 편지를 보냈어요 ✉");draw(q)}else{sb.disabled=false;m.textContent=KO[q&&q.error]||"보내지 못했어요."}})});
    var ib=card(box,"받은 편지");if(!r.inbox.length)ib.appendChild(el("p","mgs-note","아직 받은 편지가 없어요."));
    var ul=el("ul","mgs-mails");r.inbox.forEach(function(x){var li=el("li",x.fresh?"new":"");li.appendChild(el("small",null,"익명의 헌터 · "+fmtD(x.at)+(x.fresh?" · NEW":"")));li.appendChild(el("p",null,x.text));
      var h=btn("mgs-hb"+(x.heart?" on":""),x.heart?"♥ 고마워요를 보냈어요":"♡ 고마워요");h.disabled=x.heart;h.addEventListener("click",function(){h.disabled=true;call("POST","/api/mg/mail/heart",{id:x.id}).then(function(q){if(q&&q.ok){h.classList.add("on");h.textContent="♥ 고마워요를 보냈어요"}})});li.appendChild(h);ul.appendChild(li)});ib.appendChild(ul);
    if(r.sent.length){var sc=card(box,"보낸 편지");var ul2=el("ul","mgs-mails sent");r.sent.forEach(function(x){var li=el("li");li.appendChild(el("small",null,"→ "+x.to+" · "+fmtD(x.at)+" · "+(x.heart?"♥ 고마워요를 받았어요":x.seen?"읽었어요":"아직 안 읽었어요")));li.appendChild(el("p",null,x.text));ul2.appendChild(li)});sc.appendChild(ul2)}
  }
  call("GET","/api/mg/mail?read=1").then(function(r){if(!box.isConnected)return;if(!r||r._status!==200){box.innerHTML="";box.appendChild(el("p","app-empty","불러오지 못했어요."));return}draw(r);ST.mail=0;if(window.pollState)setTimeout(function(){window.pollState(false)},300)});
}

/* ═════════ 14 리본 묶기 ═════════ */
var RIBC={pink:"#f58dbb",sky:"#7cc4f5",yellow:"#f5cf5a",lavender:"#b9a2ff",mint:"#7fe0c0"};
function ribSvg(color,cls){var s=document.createElementNS("http://www.w3.org/2000/svg","svg");s.setAttribute("viewBox","0 0 32 24");s.setAttribute("class","mgs-rib"+(cls?" "+cls:""));s.setAttribute("aria-hidden","true");
  s.innerHTML='<path d="M16 11C11 4 3 2 2 7s4 10 14 5Z" fill="'+color+'"/><path d="M16 11C21 4 29 2 30 7s-4 10-14 5Z" fill="'+color+'"/><path d="M14 12l-5 11 4-2 2 3 1-11Zm4 0l5 11-4-2-2 3-1-11Z" fill="'+color+'" opacity=".85"/><circle cx="16" cy="11.5" r="3" fill="#fff" opacity=".9"/><circle cx="16" cy="11.5" r="2" fill="'+color+'"/><path d="M5 6.5c2-1.5 5 0 7 2" stroke="#fff" stroke-width="1.2" fill="none" opacity=".6"/>';return s}
function vRibbon(body){
  var box=el("div","mgs-ribw");body.appendChild(box);box.appendChild(el("p","app-empty","불러오는 중…"));
  var KO={tied:"이미 리본으로 묶인 친구가 있어요.",target_tied:"상대가 이미 다른 친구와 리본으로 묶여 있어요.",no_user:"그런 헌터를 찾을 수 없어요.",not_friend:"친구에게만 리본을 묶어 줄 수 있어요.",self:"나에게는 묶을 수 없어요.",gone:"신청이 끝났거나 취소됐어요.",rate_limited:"잠시 뒤에 다시 해 주세요."};
  function draw(r){box.innerHTML="";
    if(r.rib){var c=card(box,null);c.classList.add("mgs-ribc");var big=el("div","mgs-ribbig");big.appendChild(ribSvg(RIBC[r.rib.color],"big"));c.appendChild(big);
      c.appendChild(el("b",null,r.rib.with+" 님과 "+r.ko[r.rib.color]+" 리본으로 묶여 있어요"));c.appendChild(el("p","mgs-note","서로의 간단 프로필 사진 옆에 같은 리본이 보여요. 같은 지역에 있으면 토벌 경험치·골드 +"+Math.round(r.fx*100)+"%."));
      c.appendChild(el("p","mgs-ribst"+(r.rib.same?" on":""),r.rib.same?"✦ 지금 같은 지역("+r.rib.where+")에 있어요 · 토벌 보상 +"+Math.round(r.fx*100)+"%":"지금 "+r.rib.with+" 님은 "+r.rib.where+"에 있어요"));
      var u=btn("mgs-ghost mgs-sm","리본 풀기",function(){if(u.dataset.ok!=="1"){u.dataset.ok="1";u.textContent="정말 풀까요? 한 번 더 누르세요";return}call("POST","/api/mg/ribbon/untie").then(function(q){if(q&&q.ok)draw(q)})});c.appendChild(u)}
    if(r.incoming.length&&!r.rib){var ci=card(box,"받은 리본");r.incoming.forEach(function(i){var row=el("div","mgs-inv");row.appendChild(ribSvg(RIBC[i.color]));row.appendChild(el("span",null,i.name+" 님이 "+r.ko[i.color]+" 리본을 묶어 주려 해요"));
      row.appendChild(btn("mgs-go mgs-sm","묶기",function(){call("POST","/api/mg/ribbon/answer",{from:i.from,yes:true}).then(function(q){if(q&&q.ok){toast("✦ "+i.name+" 님과 리본으로 묶였어요!");draw(q)}else toast(KO[q&&q.error]||"처리하지 못했어요.")})}));
      row.appendChild(btn("mgs-ghost mgs-sm","거절",function(){call("POST","/api/mg/ribbon/answer",{from:i.from,yes:false}).then(function(q){if(q&&q.ok)draw(q)})}));ci.appendChild(row)})}
    if(!r.rib){var c2=card(box,"친구에게 리본 묶어 주기");note(c2,"리본은 한 번에 한 명에게만 묶을 수 있어요. 친구가 받아 주면 서로의 간단 프로필에 같은 색 리본이 생기고, 같은 지역에 있으면 토벌 보상이 조금 올라요.");
      var col=r.outgoing?r.outgoing.color:"pink",cr=el("div","mgs-cols");r.colors.forEach(function(k){var b=el("button","mgs-ribb");b.type="button";b.appendChild(ribSvg(RIBC[k]));b.appendChild(el("span",null,r.ko[k]));b.setAttribute("aria-pressed",k===col?"true":"false");b.addEventListener("click",function(){col=k;Array.prototype.forEach.call(cr.children,function(x){x.setAttribute("aria-pressed","false")});b.setAttribute("aria-pressed","true")});cr.appendChild(b)});c2.appendChild(cr);
      var f=el("form","mgs-form");var ti=el("input");ti.type="text";ti.maxLength=40;ti.placeholder="친구 닉네임 또는 코드";ti.setAttribute("aria-label","리본을 묶어 줄 친구");f.appendChild(ti);var sb=el("button","mgs-go mgs-sm","리본 보내기");sb.type="submit";f.appendChild(sb);c2.appendChild(f);var m=note(c2,r.outgoing?r.outgoing.name+" 님에게 "+r.ko[r.outgoing.color]+" 리본을 보냈어요. 받아 주길 기다리는 중 (다른 친구에게 보내면 바뀌어요)":"");
      f.addEventListener("submit",function(e){e.preventDefault();sb.disabled=true;call("POST","/api/mg/ribbon/offer",{target:ti.value.trim(),color:col}).then(function(q){sb.disabled=false;if(q&&q.ok)draw(q);else m.textContent=KO[q&&q.error]||"보내지 못했어요."})})}
  }
  call("GET","/api/mg/ribbon").then(function(r){if(!box.isConnected)return;if(!r||r._status!==200){box.innerHTML="";box.appendChild(el("p","app-empty","불러오지 못했어요."));return}draw(r)});
}


/* ═════════ 전투 속성 마법 고르기 (전투 화면의 '속성' 버튼) ═════════ */
var SRC_KO={fairy:"요정",outfit:"마법 의상",rune:"룬",weapon:"무기"};
function elemList(wel){var L=(ST.els||[]).slice();if(wel&&!L.some(function(x){return x.el===wel}))L.unshift({el:wel,ko:EL_KO[wel]||wel,src:"weapon"});else if(wel)L.forEach(function(x){if(x.el===wel)x.weapon=true});return on()?L:(wel?[{el:wel,ko:EL_KO[wel]||wel,src:"weapon"}]:[])}
var PICK=null;
function elemPick(anchor,wel,cb){
  if(PICK){PICK.remove();PICK=null}
  var L=elemList(wel);if(!L.length){cb(null);return}
  if(L.length===1){cb(L[0].src==="weapon"?"":L[0].el);return}
  var box=el("div","mgs-w mgs-epick");box.setAttribute("role","menu");box.setAttribute("aria-label","속성 마법 고르기");
  box.appendChild(el("small",null,"어떤 속성으로 공격할까요?"));
  L.forEach(function(x){var b=el("button","mgs-ep");b.type="button";b.setAttribute("role","menuitem");if(window.AFX&&AFX.iconImg){var ic=el("span","ic");ic.innerHTML=AFX.iconImg(x.el);b.appendChild(ic)}
    b.appendChild(el("b",null,x.ko));b.appendChild(el("small",null,x.src==="rune"?"룬 "+x.n+"개 (1개 사용)":x.src==="fairy"?"요정 "+(x.from||"")+" · 기본":SRC_KO[x.src]+(x.weapon?" · 무기":"")));
    b.addEventListener("click",function(){close();if(x.src==="rune"){ST.els.forEach(function(y){if(y.el===x.el&&y.src==="rune")y.n--});ST.els=ST.els.filter(function(y){return y.src!=="rune"||y.n>0})}cb(x.src==="weapon"?"":x.el)});box.appendChild(b)});
  var cx=btn("mgs-ghost mgs-sm","취소",function(){close()});box.appendChild(cx);
  document.body.appendChild(box);PICK=box;
  var r=anchor.getBoundingClientRect(),bw=Math.min(260,window.innerWidth-16);box.style.width=bw+"px";
  var left=Math.max(8,Math.min(window.innerWidth-bw-8,r.left+r.width/2-bw/2));box.style.left=left+"px";
  var h=box.offsetHeight,top=r.top-h-8;if(top<8)top=Math.min(window.innerHeight-h-8,r.bottom+8);box.style.top=top+"px";
  box.querySelector(".mgs-ep").focus();
  function close(){if(PICK===box){box.remove();PICK=null}document.removeEventListener("keydown",key,true);document.removeEventListener("pointerdown",out,true)}
  function key(e){if(e.key==="Escape"){e.stopPropagation();close()}}
  function out(e){if(!box.contains(e.target))close()}
  document.addEventListener("keydown",key,true);setTimeout(function(){document.addEventListener("pointerdown",out,true)},0);
}
/* ═════════ 다른 화면에 붙이기 ═════════ */
// 간단 프로필: 닉네임 바로 아래에 코스튬 이름표
function decorateProfile(pg,mg,f){
  if(!mg||!on())return;
  if(mg.diary&&f&&f.code){var db=btn("mgs-ghost mgs-sm mgs-pfdia","✦ 마법 일기장 보기",function(){diaryDlg(f.code,(pg.querySelector(".fp-nm")||{}).textContent||f.hn)});pg.appendChild(db)}
  var nm=pg.querySelector(".fp-nm");
  if(nm&&mg.cos)nm.insertAdjacentElement("afterend",cosTag(mg.cos,"mgs-pf"));
  var im=pg.querySelector(".fp-img");if(im&&mg.ribbon){var rb=el("span","mgs-pfrib");rb.appendChild(ribSvg(RIBC[mg.ribbon.color]||RIBC.pink));rb.title=mg.ribbon.with+" 님과 리본으로 묶여 있어요";rb.setAttribute("aria-label",rb.title);rb.setAttribute("role","img");im.appendChild(rb)}
  if(nm&&mg.team){var t=el("p","mgs-pfteam","✦ "+mg.team.name);t.style.setProperty("--tc",TCOL[mg.team.color]||TCOL.pink);nm.insertAdjacentElement("afterend",t)}
}
// PVP 대전 화면: 각 헌터 이름 위에 코스튬
function pvpSide(d,S){if(!S||!S.cos||!on())return;d.appendChild(cosTag(S.cos,"mgs-pv"))}

window.MG={elemList:elemList,elemPick:elemPick,school:school,state:onState,msgRow:msRow,msgSig:function(){return on()+":"+ST.letters+":"+(MS.fairy?MS.fairy.kind+MS.fairy.moodKo:"")},msgReset:msReset,pets:petsView,raiRow:raiRow,pvpEntry:pvpEntry,duel:duelView,diary:diaryDlg,mount:mount,transform:function(o){tfBuild().open(o)},oath:function(phrase,done){tfBuild().oath({phrase:phrase,onDone:done})},decorateProfile:decorateProfile,pvpSide:pvpSide,stop:function(){songStop();clearInterval(timer);clearInterval(DUELT)}};
})();
