const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const BOARD = 10;
const MAX_PLAYERS = 4;
const MATCH_MS = 15 * 60 * 1000;
const ATTACK_TIMEOUT_MS = 5000;
const ATTACK_COOLDOWN_MS = 4000;
const RECOVERY_MS = 5000;

const rooms = new Map();
const starts = [{x:0,y:0},{x:9,y:0},{x:0,y:9},{x:9,y:9}];
const colors = ["#e05b5b", "#4b8fe8", "#39a879", "#d49a35"];

function roomCode() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}
function key(x, y) { return `${x},${y}`; }
function inside(x, y) { return x >= 0 && x < BOARD && y >= 0 && y < BOARD; }
function manhattan(a, b) { return Math.abs(a.x-b.x) + Math.abs(a.y-b.y); }

function reachable(blocked, start, goal) {
  const queue = [start], seen = new Set([key(start.x,start.y)]);
  while (queue.length) {
    const p = queue.shift();
    if (p.x === goal.x && p.y === goal.y) return true;
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const x=p.x+dx, y=p.y+dy, k=key(x,y);
      if (inside(x,y) && !blocked.has(k) && !seen.has(k)) {
        seen.add(k); queue.push({x,y});
      }
    }
  }
  return false;
}

function makeBoard(difficulty) {
  const count = difficulty === "hard" ? 32 : difficulty === "medium" ? 23 : 13;
  const goal = {x:4,y:4};
  const blocked = new Set();
  // Keep the central destination and starting cells clear.
  const protectedCells = new Set([...starts.map(p=>key(p.x,p.y)), key(goal.x,goal.y)]);
  let attempts = 0;
  while (blocked.size < count && attempts++ < 2000) {
    const x = Math.floor(Math.random()*BOARD), y = Math.floor(Math.random()*BOARD);
    const k = key(x,y);
    if (protectedCells.has(k)) continue;
    blocked.add(k);
    if (!starts.every(s => reachable(blocked, s, goal))) blocked.delete(k);
  }
  return [...blocked].map(k => k.split(",").map(Number)).map(([x,y])=>({x,y}));
}

function publicState(room) {
  return {
    code: room.code,
    status: room.status,
    difficulty: room.difficulty,
    boardSize: BOARD,
    blocked: room.blocked,
    goal: room.goal,
    players: [...room.players.values()].map(p => ({
      id:p.id, name:p.name, color:p.color, x:p.x, y:p.y,
      points:p.points, arrived:p.arrived, arrivalOrder:p.arrivalOrder,
      connected:p.connected, walking:p.walking
    })),
    pendingAttacks: [...room.attacks.values()].map(a => ({
      id:a.id, attackerId:a.attackerId, defenderId:a.defenderId,
      amount:a.amount, expiresAt:a.expiresAt
    })),
    remainingMs: room.startedAt ? Math.max(0, MATCH_MS-(Date.now()-room.startedAt)) : MATCH_MS,
    message: room.message
  };
}
function broadcast(room) { io.to(room.code).emit("state", publicState(room)); }
function emitError(socket, message) { socket.emit("errorMessage", message); }

function createRoom(socket, name, difficulty) {
  let code;
  do { code=roomCode(); } while (rooms.has(code));
  const room = {
    code, difficulty: ["easy","medium","hard"].includes(difficulty) ? difficulty : "easy",
    players:new Map(), blocked:[], goal:{x:4,y:4}, status:"lobby",
    attacks:new Map(), startedAt:null, arrivalCounter:0, message:"Waiting for players.",
    timers:new Map()
  };
  rooms.set(code, room);
  return joinRoom(socket, name, code);
}
function joinRoom(socket, name, code) {
  const room = rooms.get(String(code||"").toUpperCase());
  if (!room) return emitError(socket, "Room not found.");
  if (room.status !== "lobby") return emitError(socket, "This game has already started.");
  if (room.players.size >= MAX_PLAYERS) return emitError(socket, "This room is full.");
  const index = room.players.size, pos = starts[index];
  const player = {
    id:socket.id, name:String(name||`Player ${index+1}`).slice(0,18),
    color:colors[index], x:pos.x, y:pos.y, points:100,
    arrived:false, arrivalOrder:null, connected:true,
    walking:false, lastMoveAt:0, lastAttackAt:0, stationarySince:Date.now()
  };
  room.players.set(socket.id, player);
  socket.join(room.code);
  room.message = `${player.name} joined (${room.players.size}/${MAX_PLAYERS}).`;
  broadcast(room);
  if (room.players.size === MAX_PLAYERS) startGame(room);
}
function startGame(room) {
  room.blocked = makeBoard(room.difficulty);
  room.status = "playing";
  room.startedAt = Date.now();
  room.message = "Game started! Reach the destination.";
  broadcast(room);
  room.matchTimer = setTimeout(()=>finishGame(room), MATCH_MS);
  room.recoveryTimer = setInterval(()=> {
    if (room.status !== "playing") return;
    const now = Date.now();
    for (const p of room.players.values()) {
      if (!p.arrived && p.points === 0 && now-p.stationarySince >= RECOVERY_MS) {
        p.points = 1;
        p.stationarySince = now;
        io.to(p.id).emit("notice","You recovered 1 point.");
      }
    }
    broadcast(room);
  }, 1000);
}
function finishGame(room) {
  if (room.status !== "playing") return;
  room.status = "finished";
  room.message = "Time is up. Final rankings are ready.";
  const ranking = [...room.players.values()].sort((a,b)=>{
    if (a.arrived !== b.arrived) return a.arrived ? -1 : 1;
    if (a.arrived && b.arrived) return a.arrivalOrder-b.arrivalOrder;
    const da=manhattan(a,room.goal), db=manhattan(b,room.goal);
    return da-db || b.points-a.points;
  }).map((p,i)=>({rank:i+1,id:p.id,name:p.name,points:p.points,arrived:p.arrived,distance:manhattan(p,room.goal)}));
  io.to(room.code).emit("gameOver", ranking);
  broadcast(room);
  clearInterval(room.recoveryTimer);
  clearTimeout(room.matchTimer);
  for (const t of room.timers.values()) clearTimeout(t);
}
function cellBlocked(room,x,y) {
  return room.blocked.some(c=>c.x===x && c.y===y);
}
function tryMove(room, player, dx, dy, mode) {
  if (room.status!=="playing" || player.arrived) return;
  if (![-1,0,1].includes(dx)||![-1,0,1].includes(dy)||Math.abs(dx)+Math.abs(dy)!==1) return;
  const sprint = mode==="sprint";
  const cost = sprint ? 2 : 1;
  const interval = sprint ? 350 : 700;
  const now=Date.now();
  if (now-player.lastMoveAt < interval-30) return;
  if (player.points < cost) return;
  const x=player.x+dx, y=player.y+dy;
  if (!inside(x,y)||cellBlocked(room,x,y)) return;
  player.points-=cost;
  player.x=x; player.y=y; player.lastMoveAt=now; player.stationarySince=now;
  if (x===room.goal.x && y===room.goal.y) {
    player.arrived=true;
    player.arrivalOrder=++room.arrivalCounter;
    player.walking=false;
    room.message=`${player.name} reached the destination!`;
    if ([...room.players.values()].every(p=>p.arrived)) finishGame(room);
  }
  broadcast(room);
}
function startAttack(room, attacker, defenderId, amount) {
  const defender=room.players.get(defenderId);
  if (!defender || defender.id===attacker.id || attacker.arrived || defender.arrived) return;
  if (room.status!=="playing") return;
  if (manhattan(attacker,defender)!==1) return;
  amount=Number(amount);
  if (!Number.isInteger(amount)||amount<10||amount%5!==0||amount>attacker.points) return;
  if (Date.now()-attacker.lastAttackAt<ATTACK_COOLDOWN_MS) return;
  if ([...room.attacks.values()].some(a=>a.defenderId===defender.id)) return;
  attacker.points-=amount;
  attacker.lastAttackAt=Date.now();
  const id=crypto.randomUUID();
  const attack={id,attackerId:attacker.id,defenderId:defender.id,amount,expiresAt:Date.now()+ATTACK_TIMEOUT_MS};
  room.attacks.set(id,attack);
  room.message=`${attacker.name} challenged ${defender.name}.`;
  io.to(defender.id).emit("attackIncoming", {
    id, attackerName:attacker.name, amount, expiresAt:attack.expiresAt
  });
  const timer=setTimeout(()=>resolveAttack(room,id,"accept"),ATTACK_TIMEOUT_MS);
  room.timers.set(id,timer);
  broadcast(room);
}
function resolveAttack(room, attackId, choice) {
  const attack=room.attacks.get(attackId);
  if (!attack) return;
  const attacker=room.players.get(attack.attackerId);
  const defender=room.players.get(attack.defenderId);
  room.attacks.delete(attackId);
  clearTimeout(room.timers.get(attackId));
  room.timers.delete(attackId);
  if (!attacker || !defender || defender.arrived || attacker.arrived) return;
  if (choice==="defend") {
    if (defender.points>=attack.amount) {
      defender.points-=attack.amount;
      room.message=`${defender.name} defended successfully.`;
    } else {
      defender.points+=attack.amount;
      knockback(room, attacker, defender);
      room.message=`${defender.name} could not afford defence and accepted the attack.`;
    }
  } else {
    defender.points+=attack.amount;
    knockback(room, attacker, defender);
    room.message=`${defender.name} accepted the attack and was pushed back.`;
  }
  defender.stationarySince=Date.now();
  broadcast(room);
}
function knockback(room, attacker, defender) {
  const dx=Math.sign(defender.x-attacker.x), dy=Math.sign(defender.y-attacker.y);
  const x=defender.x+dx, y=defender.y+dy;
  if (inside(x,y) && !cellBlocked(room,x,y) && !(x===room.goal.x&&y===room.goal.y)) {
    defender.x=x; defender.y=y;
  }
}

io.on("connection", socket=>{
  socket.on("createGame", ({name,difficulty})=>createRoom(socket,name,difficulty));
  socket.on("joinGame", ({name,code})=>joinRoom(socket,name,code));
  socket.on("move", ({dx,dy,mode})=>{
    const room=[...rooms.values()].find(r=>r.players.has(socket.id));
    if (!room) return;
    tryMove(room,room.players.get(socket.id),Number(dx),Number(dy),mode);
  });
  socket.on("shareRequest", ({targetId,amount})=>{
    const room=[...rooms.values()].find(r=>r.players.has(socket.id));
    if (!room) return;
    const sender=room.players.get(socket.id), target=room.players.get(targetId);
    amount=Number(amount);
    if (!target||sender.arrived||target.arrived||manhattan(sender,target)!==0||
       !Number.isInteger(amount)||amount<1||amount>sender.points) return;
    const id=crypto.randomUUID();
    room.pendingShares ??= new Map();
    room.pendingShares.set(id,{id,senderId:sender.id,targetId:target.id,amount});
    io.to(target.id).emit("shareIncoming",{id,senderName:sender.name,amount});
    socket.emit("notice","Sharing request sent.");
  });
  socket.on("shareResponse", ({id,accept})=>{
    const room=[...rooms.values()].find(r=>r.players.has(socket.id));
    if (!room||!room.pendingShares) return;
    const req=room.pendingShares.get(id);
    if (!req||req.targetId!==socket.id) return;
    room.pendingShares.delete(id);
    const sender=room.players.get(req.senderId), target=room.players.get(req.targetId);
    if (!accept||!sender||!target||manhattan(sender,target)!==0||sender.points<req.amount) return;
    sender.points-=req.amount; target.points+=req.amount;
    sender.stationarySince=target.stationarySince=Date.now();
    room.message=`${sender.name} shared ${req.amount} points with ${target.name}.`;
    broadcast(room);
  });
  socket.on("attack", ({targetId,amount})=>{
    const room=[...rooms.values()].find(r=>r.players.has(socket.id));
    if (!room) return;
    startAttack(room,room.players.get(socket.id),targetId,amount);
  });
  socket.on("attackResponse", ({id,choice})=>{
    const room=[...rooms.values()].find(r=>r.players.has(socket.id));
    if (!room) return;
    const a=room.attacks.get(id);
    if (!a||a.defenderId!==socket.id) return;
    resolveAttack(room,id,choice==="defend"?"defend":"accept");
  });
  socket.on("disconnect",()=>{
    for (const room of rooms.values()) {
      const p=room.players.get(socket.id);
      if (!p) continue;
      p.connected=false;
      room.message=`${p.name} disconnected.`;
      broadcast(room);
      if (room.status==="lobby") {
        room.players.delete(socket.id);
        if (room.players.size===0) rooms.delete(room.code);
      }
    }
  });
});

server.listen(PORT,()=>console.log(`Gridbound running at http://localhost:${PORT}`));
