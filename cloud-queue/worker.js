// ST-iPhonie shared NovelAI queue: a Cloudflare Worker with one Durable Object per room.
// Friends who share a NovelAI account put the same service address and room code into the plugin. Before every
// NovelAI request a plugin joins the room, waits until it is first in line, draws, and leaves. The service keeps a
// short gap between two turns, and when someone got "account busy" (429) everyone waits out the cooldown together.
// It only ever sees the room code, random tickets and short labels such as "正文图片".
//
// POST /q/<room>  {op: 'join', label} | {op: 'poll', ticket} | {op: 'renew', ticket}
//                 {op: 'leave', ticket, outcome: 'done' | 'busy', cooldown} | {op: 'status'}
// Answer: {ticket?, state: 'waiting' | 'granted' | 'gone', position, length, holder, cooldown}

const LEASE_MS = 120000;      // a turn lasts at most this long without a renew
const TICKET_TTL_MS = 45000;  // a waiting ticket that stops polling is dropped
const GAP_MS = 3000;          // pause between two turns
const MAX_COOLDOWN_MS = 180000;
const CORS = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400'};
const json = (value, status = 200) => new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json', ...CORS}});

export class NovelAIQueue {
  constructor(state, env, now = () => Date.now()) {
    this.env = env;
    this.now = now;
    this.line = [];        // [{id, label, seen}]
    this.holder = null;    // {id, until}
    this.nextAt = 0;       // no turn starts before this time
  }
  tidy() {
    const now = this.now();
    if (this.holder && this.holder.until < now) {
      this.line = this.line.filter(t => t.id !== this.holder.id);
      this.holder = null;
      this.nextAt = Math.max(this.nextAt, now + GAP_MS);
    }
    this.line = this.line.filter(t => t.id === this.holder?.id || t.seen > now - TICKET_TTL_MS);
    if (!this.holder && this.line.length && now >= this.nextAt) this.holder = {id: this.line[0].id, until: now + LEASE_MS};
  }
  view(id) {
    const now = this.now(), index = this.line.findIndex(t => t.id === id);
    const holder = this.holder ? this.line.find(t => t.id === this.holder.id)?.label || '有人' : '';
    return {
      ...(id ? {ticket: id} : {}),
      state: !id ? 'status' : index < 0 ? 'gone' : this.holder?.id === id ? 'granted' : 'waiting',
      position: index, length: this.line.length, holder, cooldown: Math.max(0, this.nextAt - now)
    };
  }
  async fetch(request) {
    let body = {};
    try { body = await request.json(); } catch { return json({error: 'bad request'}, 400); }
    const now = this.now(), find = id => this.line.find(t => t.id === id);
    this.tidy();
    switch (body.op) {
      case 'join': {
        if (this.line.length >= 50) return json({error: 'room is full'}, 429);
        const id = crypto.randomUUID();
        this.line.push({id, label: String(body.label || '').slice(0, 40), seen: now});
        this.tidy();
        return json(this.view(id));
      }
      case 'poll': {
        const t = find(body.ticket);
        if (t) t.seen = now;
        this.tidy();
        return json(this.view(body.ticket));
      }
      case 'renew': {
        if (this.holder?.id === body.ticket) this.holder.until = now + LEASE_MS;
        const t = find(body.ticket);
        if (t) t.seen = now;
        return json(this.view(body.ticket));
      }
      case 'leave': {
        const wasHolder = this.holder?.id === body.ticket;
        this.line = this.line.filter(t => t.id !== body.ticket);
        if (wasHolder) {
          this.holder = null;
          const cooldown = body.outcome === 'busy' ? Math.min(MAX_COOLDOWN_MS, Math.max(GAP_MS, Number(body.cooldown) || 15000)) : GAP_MS;
          this.nextAt = Math.max(this.nextAt, now + cooldown);
        }
        this.tidy();
        return json({state: 'left', length: this.line.length});
      }
      case 'status': return json(this.view(null));
      default: return json({error: 'unknown op'}, 400);
    }
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: CORS});
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/') return json({service: 'ST-iPhonie NovelAI queue', ok: true});
    const match = url.pathname.match(/^\/q\/([A-Za-z0-9_-]{16,64})$/);
    if (!match || request.method !== 'POST') return json({error: 'not found'}, 404);
    const stub = env.QUEUE.get(env.QUEUE.idFromName(match[1]));
    return stub.fetch(request);
  }
};
