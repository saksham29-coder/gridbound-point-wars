const socket = io();
const $ = id => document.getElementById(id);
let state=null, myId=null, pending=null, held=null, moveLoop=null;
const lobby=$("lobby"), game=$("game"), board=$("board");
socket.on("connect",()=>{$("connection").textContent="Connected";myId=socket.id;});
socket.on("disconnect",()=>{$("connection").textContent="Disconnected";});
socket.on("errorMessage",m=>$("lobbyError").textContent=m);
socket.on("notice",showToast);
socket.on("state",s=>{state=s; if(s.players.some(p=>p.id===myId)){lobby.classList.add("hidden");game.classList.remove("hidden");} render();});
socket.on("attackIncoming",data=>showDecision("Attack challenge",`${data.attackerName} offered ${data.amount} points. Defend by spending the same amount, or accept the offer and be pushed back.`,choice=>socket.emit("attackResponse",{id:data.id,choice})));
socket.on("shareIncoming",data=>showDecision("Point transfer",`${data.senderName} wants to transfer ${data.amount} points to you.`,choice=>socket.emit("shareResponse",{id:data.id,accept:choice==="accept"})));
socket.on("gameOver",ranking=>{showDecision("Game finished",ranking.map(r=>`${r.rank}. ${r.name} — ${r.points} pts${r.arrived?" (arrived)": " (not arrived)"}`).join("\n"),()=>{pending=null;});$("acceptBtn").textContent="Close";$("declineBtn").classList.add("hidden");});

$("createBtn").onclick=()=>socket.emit("createGame",{name:$("playerName").value||"Player",difficulty:$("difficulty").value});
$("joinBtn").onclick=()=>socket.emit("joinGame",{name:$("playerName").value||"Player",code:$("roomCode").value.trim().toUpperCase()});
document.querySelectorAll("[data-move]").forEach(b=>b.onclick=()=>{const [dx,dy]=b.dataset.move.split(",").map(Number);move(dx,dy);});
function move(dx,dy){if(!state)return;socket.emit("move",{dx,dy,mode:$("moveMode").value});}
function stopMove(){if(moveLoop){clearInterval(moveLoop);moveLoop=null;}held=null;}
function beginMove(dx,dy){stopMove();held={dx,dy};move(dx,dy);moveLoop=setInterval(()=>move(dx,dy),$("moveMode").value==="sprint"?350:700);}
document.addEventListener("keydown",e=>{
  if(["INPUT","SELECT"].includes(document.activeElement.tagName))return;
  const map={ArrowUp:[0,-1],w:[0,-1],ArrowDown:[0,1],s:[0,1],ArrowLeft:[-1,0],a:[-1,0],ArrowRight:[1,0],d:[1,0]};
  const v=map[e.key];if(v){e.preventDefault();if(!held||held.dx!==v[0]||held.dy!==v[1])beginMove(...v);}
});
document.addEventListener("keyup",e=>{if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","w","a","s","d"].includes(e.key))stopMove();});
window.addEventListener("blur",stopMove);
$("shareBtn").onclick=()=>{const target=$("targetPlayer").value,amount=Number($("amount").value);if(target)socket.emit("shareRequest",{targetId:target,amount});};
$("attackBtn").onclick=()=>{const target=$("targetPlayer").value,amount=Number($("amount").value);if(target)socket.emit("attack",{targetId:target,amount});};
function render(){
 if(!state)return;
 $("roomLabel").textContent=state.code;
 $("gameStatus").textContent=state.status;
 $("timer").textContent=formatTime(state.remainingMs);
 $("gameMessage").textContent=state.message||"";
 board.innerHTML="";
 const blocked=new Set(state.blocked.map(c=>`${c.x},${c.y}`));
 for(let y=0;y<10;y++)for(let x=0;x<10;x++){
   const cell=document.createElement("div");cell.className="cell";
   if(blocked.has(`${x},${y}`))cell.classList.add("blocked");
   if(state.goal.x===x&&state.goal.y===y){cell.classList.add("goal");cell.innerHTML='<span class="goalmark">◆</span>';}
   const here=state.players.filter(p=>p.x===x&&p.y===y);
   if(here.length){const wrap=document.createElement("div");wrap.className="tokens";here.forEach(p=>{const t=document.createElement("div");t.className="token";t.style.background=p.color;t.textContent=p.name.slice(0,1).toUpperCase();t.title=p.name;wrap.appendChild(t);});cell.appendChild(wrap);}
   board.appendChild(cell);
 }
 $("players").innerHTML=state.players.map(p=>`<div class="player-card"><span class="player-name"><i class="dot" style="background:${p.color}"></i>${escapeHtml(p.name)} ${p.id===myId?"(you)":""}</span><span><b>${p.points}</b> pts ${p.arrived?"✓":""}</span></div>`).join("");
 const me=state.players.find(p=>p.id===myId);
 const targets=state.players.filter(p=>p.id!==myId&&!p.arrived&&me&&!me.arrived&&((Math.abs(p.x-me.x)+Math.abs(p.y-me.y)<=1)));
 $("targetPlayer").innerHTML='<option value="">Select nearby player</option>'+targets.map(p=>`<option value="${p.id}">${escapeHtml(p.name)} (${p.points} pts)</option>`).join("");
 $("shareBtn").disabled=!targets.some(p=>me&&p.x===me.x&&p.y===me.y);
 $("attackBtn").disabled=!targets.some(p=>me&&Math.abs(p.x-me.x)+Math.abs(p.y-me.y)===1);
}
function formatTime(ms){const s=Math.ceil(ms/1000);return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function showToast(msg){const t=$("toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2200);}
function showDecision(title,text,callback){
 pending=callback;$("modalTitle").textContent=title;$("modalText").textContent=text;$("modalText").style.whiteSpace="pre-line";
 $("acceptBtn").textContent="Accept";$("declineBtn").textContent="Decline";$("declineBtn").classList.remove("hidden");$("modal").classList.remove("hidden");
}
$("acceptBtn").onclick=()=>{if(pending)pending("accept");closeModal();};
$("declineBtn").onclick=()=>{if(pending)pending("defend");closeModal();};
function closeModal(){pending=null;$("modal").classList.add("hidden");}
