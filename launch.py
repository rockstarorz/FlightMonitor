from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Timer
import webbrowser

class LocalServer(ThreadingHTTPServer):
    request_queue_size = 128


handler = partial(SimpleHTTPRequestHandler, directory=Path(__file__).resolve().parent / "dist")
with LocalServer(("127.0.0.1", 0), handler) as server:
    url = f"http://127.0.0.1:{server.server_port}/"
    print(f"三维航迹已启动  {url}\n关闭此窗口即可停止本地服务。", flush=True)
    Timer(0.25, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
