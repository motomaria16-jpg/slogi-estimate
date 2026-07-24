#!/usr/bin/env python3
"""СЛОГИ: статический сайт + простое общее хранилище объектов и файлов.
Запуск: python server.py --host 0.0.0.0 --port 8000
Все устройства должны открывать один и тот же URL этого сервера.
"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, unquote
import argparse, json, os, re, tempfile, mimetypes

ROOT=Path(__file__).resolve().parent
DATA=ROOT/'data'
ATT=DATA/'attachments'
LOCATIONS=DATA/'locations.json'
API_KEY=os.environ.get('SLOGI_API_KEY','')
SAFE=re.compile(r'[^A-Za-z0-9._-]+')

def safe(value):
    return SAFE.sub('_',value)[:180] or 'item'

def atomic_write(path,data:bytes):
    path.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(prefix=path.name+'.',dir=str(path.parent))
    try:
        with os.fdopen(fd,'wb') as f:f.write(data)
        os.replace(tmp,path)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)

def read_locations():
    try:
        data=json.loads(LOCATIONS.read_text(encoding='utf-8')) if LOCATIONS.exists() else []
        return data if isinstance(data,list) else []
    except Exception:return []

def attachment_paths(location_id,kind):
    stem=safe(location_id)+'__'+safe(kind)
    return ATT/(stem+'.bin'),ATT/(stem+'.json')

class Handler(SimpleHTTPRequestHandler):
    server_version='SlogiServer/1.0'
    def translate_path(self,path):
        # Static files are always served from ROOT, regardless of cwd.
        clean=urlparse(path).path.lstrip('/') or 'index.html'
        clean=os.path.normpath(unquote(clean)).lstrip(os.sep)
        target=(ROOT/clean).resolve()
        root=ROOT.resolve()
        if target!=root and root not in target.parents:
            return str(ROOT/'index.html')
        return str(target)
    def end_headers(self):
        path=urlparse(self.path).path.lower()
        if not path.startswith('/api/') and (path in ('/','/index.html') or path.endswith(('.html','.js','.css'))):
            self.send_header('Cache-Control','no-store, no-cache, must-revalidate, max-age=0')
            self.send_header('Pragma','no-cache')
            self.send_header('Expires','0')
        super().end_headers()
    def _authorized(self):
        return not API_KEY or self.headers.get('X-Slogi-Key','')==API_KEY
    def _json(self,status,payload):
        raw=json.dumps(payload,ensure_ascii=False,separators=(',',':')).encode('utf-8')
        self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(raw)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(raw)
    def _body(self):
        length=int(self.headers.get('Content-Length','0') or 0)
        return self.rfile.read(length)
    def do_GET(self):
        path=urlparse(self.path).path
        if path=='/api/locations' or path=='/api/locations/':
            if not self._authorized():return self._json(401,{'error':'unauthorized'})
            return self._json(200,read_locations())
        m=re.fullmatch(r'/api/attachments/([^/]+)/([^/]+)',path)
        if m:
            if not self._authorized():return self._json(401,{'error':'unauthorized'})
            location_id,kind=map(unquote,m.groups());binp,metap=attachment_paths(location_id,kind)
            if not binp.exists():return self._json(404,{'error':'not found'})
            meta={}
            try:meta=json.loads(metap.read_text(encoding='utf-8'))
            except Exception:pass
            raw=binp.read_bytes();ctype=meta.get('mime') or mimetypes.guess_type(meta.get('name',''))[0] or 'application/octet-stream'
            self.send_response(200);self.send_header('Content-Type',ctype);self.send_header('Content-Length',str(len(raw)));self.send_header('X-File-Name',meta.get('encodedName',''));self.send_header('X-Updated-At',meta.get('updatedAt',''));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(raw);return
        return super().do_GET()
    def do_PUT(self):
        path=urlparse(self.path).path
        if not self._authorized():return self._json(401,{'error':'unauthorized'})
        if path=='/api/locations' or path=='/api/locations/':
            try:
                raw=self._body();data=json.loads(raw.decode('utf-8'));assert isinstance(data,list)
                atomic_write(LOCATIONS,json.dumps(data,ensure_ascii=False,indent=2).encode('utf-8'))
                return self._json(200,{'ok':True,'count':len(data)})
            except Exception as e:return self._json(400,{'error':'invalid locations'})
        m=re.fullmatch(r'/api/attachments/([^/]+)/([^/]+)',path)
        if m:
            location_id,kind=map(unquote,m.groups());raw=self._body();binp,metap=attachment_paths(location_id,kind)
            atomic_write(binp,raw)
            encoded=self.headers.get('X-File-Name','')
            meta={'locationId':location_id,'type':kind,'encodedName':encoded,'mime':self.headers.get('Content-Type','application/octet-stream'),'updatedAt':self.date_time_string()}
            atomic_write(metap,json.dumps(meta,ensure_ascii=False,indent=2).encode('utf-8'))
            return self._json(200,{'ok':True})
        return self._json(404,{'error':'not found'})
    def do_DELETE(self):
        path=urlparse(self.path).path
        if not self._authorized():return self._json(401,{'error':'unauthorized'})
        m=re.fullmatch(r'/api/attachments/([^/]+)',path)
        if not m:return self._json(404,{'error':'not found'})
        prefix=safe(unquote(m.group(1)))+'__';removed=0
        if ATT.exists():
            for p in ATT.iterdir():
                if p.name.startswith(prefix):p.unlink(missing_ok=True);removed+=1
        return self._json(200,{'ok':True,'removed':removed})
    def log_message(self,fmt,*args):
        print('%s - %s'%(self.address_string(),fmt%args))

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--host',default='127.0.0.1');parser.add_argument('--port',type=int,default=8000);args=parser.parse_args()
    DATA.mkdir(exist_ok=True);ATT.mkdir(exist_ok=True)
    server=ThreadingHTTPServer((args.host,args.port),Handler)
    print(f'СЛОГИ: http://{args.host}:{args.port}  data={DATA}')
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()
if __name__=='__main__':main()
