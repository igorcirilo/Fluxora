import os, sqlite3, secrets, hashlib, hmac, json, re, time
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit
from http.cookies import SimpleCookie
from html import escape
from contextlib import contextmanager
from engine import cents,limit_report,cash_report
DB=os.getenv('DB_PATH','mei.db'); SECURE=os.getenv('SECURE_COOKIE','0')=='1'; ORIGIN=os.getenv('APP_ORIGIN','http://localhost:8000')
@contextmanager
def db():
    c=sqlite3.connect(DB,timeout=10); c.row_factory=sqlite3.Row; c.execute('PRAGMA foreign_keys=ON')
    try:
        with c: yield c
    finally: c.close()
def init():
    with db() as c: c.executescript(open(os.path.join(os.path.dirname(__file__),'sql/sqlite.sql')).read())
def password(p,s): return hashlib.scrypt(p.encode(),salt=bytes.fromhex(s),n=2**14,r=8,p=1).hex()
def digest(t): return hashlib.sha256(t.encode()).hexdigest()
def session(c,token):
    return c.execute('SELECT u.id,u.tenant_id,t.opened,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id JOIN tenants t ON t.id=u.tenant_id WHERE s.token=? AND s.expires>?',(digest(token),int(time.time()))).fetchone()
def entries(c,tenant): return [dict(r) for r in c.execute('SELECT * FROM entries WHERE tenant_id=? ORDER BY day DESC,id DESC',(tenant,))]
def money(n): return f'R$ {n/100:,.2f}'.replace(',','_').replace('.',',').replace('_','.')
class Handler(BaseHTTPRequestHandler):
    def reply(self,body,status=200,cookie=None,kind='text/html; charset=utf-8'):
        self.send_response(status); self.send_header('Content-Type',kind); self.send_header('Cache-Control','no-store'); self.send_header('X-Content-Type-Options','nosniff'); self.send_header('X-Frame-Options','DENY'); self.send_header('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"); self.send_header('Referrer-Policy','no-referrer')
        if SECURE: self.send_header('Strict-Transport-Security','max-age=31536000')
        if cookie: self.send_header('Set-Cookie',cookie)
        self.end_headers(); self.wfile.write(body.encode())
    def cookie(self,t,age=86400): return f'sid={t}; Path=/; HttpOnly; SameSite=Strict; Max-Age={age}'+('; Secure' if SECURE else '')
    def token(self):
        try: return SimpleCookie(self.headers.get('Cookie','')).get('sid').value
        except Exception: return ''
    def page(self,content): return '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MEI Gestão</title><style>body{font:16px system-ui;background:#f2f5f8;color:#173047;max-width:850px;margin:30px auto;padding:16px}section,form{background:white;padding:18px;border-radius:12px;margin:12px 0}input,select,button{font:inherit;padding:10px;margin:5px;max-width:90%}button{background:#174f79;color:white;border:0;border-radius:6px}table{width:100%;text-align:left}td{padding:8px;border-bottom:1px solid #ddd}</style><h1>MEI Gestão</h1>'+content+'</html>'
    def do_GET(self):
        with db() as c:
            u=session(c,self.token()); path=urlsplit(self.path).path
            if path=='/health': return self.reply('ok',kind='text/plain')
            if not u: return self.reply(self.page('<form method="post" action="/login"><h2>Entrar</h2><input name="email" type="email" required><input name="password" type="password" required><button>Entrar</button></form><form method="post" action="/register"><h2>Criar empresa</h2><input name="name" placeholder="Empresa" required><input name="email" type="email" required><input name="password" type="password" minlength="12" required><label>Data de abertura <input name="opened" type="date" required></label><button>Cadastrar</button></form>'))
            rows=entries(c,u['tenant_id']); today=date.today(); q=parse_qs(urlsplit(self.path).query)
            if path=='/export': return self.reply(json.dumps(rows,ensure_ascii=False),kind='application/json')
            try: year=int(q.get('year',[today.year])[0]); month=int(q.get('month',[today.month])[0]); a=limit_report(rows,date.fromisoformat(u['opened']),year); b=cash_report(rows,year,month)
            except ValueError: return self.reply('Período inválido',400)
            hidden=f'<input type="hidden" name="csrf" value="{u["csrf"]}">'; table=''.join(f'<tr><td>{r["day"]}</td><td>{r["kind"]}</td><td>{escape(r["description"])}</td><td>{money(r["amount"])}</td></tr>' for r in rows[:100]); stats=''.join(f'<p>{k}: <b>{money(v) if isinstance(v,int) else escape(v)}</b></p>' for k,v in {**a,**b}.items())
            return self.reply(self.page(f'<form method="get"><input name="year" type="number" value="{year}"><input name="month" type="number" min="1" max="12" value="{month}"><button>Filtrar</button></form><section>{stats}<small>Receita por competência e caixa por recebimento; regra padrão MEI parametrizada no motor. Não substitui contador.</small></section><form method="post" action="/entry">{hidden}<select name="kind"><option value="sale">Venda / receita (competência)</option><option value="receipt">Entrada de caixa</option><option value="expense">Saída de caixa</option></select><input name="day" type="date" value="{today}" required><input name="description" maxlength="200" required><input name="amount" type="number" step="0.01" min="0.01" required><button>Registrar</button></form><section><table>{table}</table><a href="/export">Exportar JSON</a></section><form method="post" action="/logout">{hidden}<button>Sair</button></form>'))
    def do_POST(self):
        if self.headers.get('Origin')!=ORIGIN: return self.reply('Origem inválida',403)
        try:
            size=int(self.headers.get('Content-Length','0')); assert 0<size<=16000
            f={k:v[0] for k,v in parse_qs(self.rfile.read(size).decode()).items()}; path=self.path
            with db() as c:
                if path in ('/login','/register'):
                    now=int(time.time()); ip=self.client_address[0]; c.execute('DELETE FROM attempts WHERE stamp<?',(now-900,)); count=c.execute('SELECT count(*) FROM attempts WHERE ip=?',(ip,)).fetchone()[0]
                    if count>=15: return self.reply('Tente mais tarde',429)
                    c.execute('INSERT INTO attempts VALUES (?,?)',(ip,now)); email=f.get('email','').strip().lower(); p=f.get('password',''); assert re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+',email) and len(email)<=254 and 12<=len(p)<=128
                    if path=='/register':
                        opened=date.fromisoformat(f['opened']); name=f['name'].strip(); assert 0<len(name)<=150 and opened<=date.today(); salt=secrets.token_hex(16); tid=c.execute('INSERT INTO tenants(name,opened) VALUES (?,?)',(name,str(opened))).lastrowid; uid=c.execute('INSERT INTO users(tenant_id,email,salt,pwhash) VALUES (?,?,?,?)',(tid,email,salt,password(p,salt))).lastrowid
                    else:
                        r=c.execute('SELECT * FROM users WHERE email=?',(email,)).fetchone(); check=password(p,r['salt'] if r else '00'*16)
                        if not r or not hmac.compare_digest(check,r['pwhash']): return self.reply('Credenciais inválidas',401)
                        uid=r['id']
                    t=secrets.token_urlsafe(32); c.execute('DELETE FROM sessions WHERE expires<?',(now,)); c.execute('INSERT INTO sessions VALUES (?,?,?,?)',(digest(t),uid,secrets.token_hex(24),now+86400)); return self.reply(self.page('<a href="/">Abrir painel</a>'),cookie=self.cookie(t))
                u=session(c,self.token());
                if not u or not hmac.compare_digest(f.get('csrf',''),u['csrf']): return self.reply('Acesso negado',403)
                if path=='/logout': c.execute('DELETE FROM sessions WHERE token=?',(digest(self.token()),)); return self.reply(self.page('<a href="/">Entrar novamente</a>'),cookie=self.cookie('',0))
                if path!='/entry': return self.reply('Não encontrado',404)
                k=f['kind']; d=date.fromisoformat(f['day']); desc=f['description'].strip(); assert k in ('sale','receipt','expense') and 0<len(desc)<=200 and d>=date.fromisoformat(u['opened']) and d<=date.today(); a=cents(f['amount']); rid=c.execute('INSERT INTO entries(tenant_id,kind,day,description,amount) VALUES (?,?,?,?,?)',(u['tenant_id'],k,str(d),desc,a)).lastrowid; c.execute('INSERT INTO audit(tenant_id,user_id,action,entity_id) VALUES (?,?,?,?)',(u['tenant_id'],u['id'],'entry.create',rid)); return self.reply(self.page('<p>Registrado.</p><a href="/">Voltar</a>'))
        except (ValueError,KeyError,AssertionError,sqlite3.IntegrityError): return self.reply('Dados inválidos ou cadastro já existente.',400)
if __name__=='__main__': init(); ThreadingHTTPServer(('0.0.0.0',8000),Handler).serve_forever()
