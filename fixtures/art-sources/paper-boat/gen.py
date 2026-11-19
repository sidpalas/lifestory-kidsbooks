"""Cached OpenAI image calls for the Paper Boat placeholder art. Never re-requests a file that exists.
usage: gen.py generate <out.png> <size> <quality> <prompt>
       gen.py edit <out.png> <in.png> <size> <quality> <prompt>
"""
import base64, json, os, sys, time, urllib.error, urllib.request, uuid

MODEL = os.environ.get("ART_MODEL", "gpt-image-2.6-sunburst")
KEY = os.environ["OPENAI_API_KEY"]
LOG = os.path.join(os.path.dirname(__file__), "usage.jsonl")


def post(url, body, content_type):
    for attempt in range(6):
        req = urllib.request.Request(url, data=body, headers={"Authorization": f"Bearer {KEY}", "Content-Type": content_type})
        try:
            with urllib.request.urlopen(req, timeout=600) as res:
                return json.loads(res.read())
        except urllib.error.HTTPError as error:
            # Rate limits aren't billed: wait and try again.
            if error.code != 429 or attempt == 5:
                raise
            time.sleep(20 * (attempt + 1))


def multipart(fields, files):
    boundary = uuid.uuid4().hex
    out = b""
    for k, v in fields.items():
        out += f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
    for k, path in files:
        out += f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"; filename=\"{os.path.basename(path)}\"\r\nContent-Type: image/png\r\n\r\n".encode()
        out += open(path, "rb").read() + b"\r\n"
    return out + f"--{boundary}--\r\n".encode(), f"multipart/form-data; boundary={boundary}"


def main():
    mode, out = sys.argv[1], sys.argv[2]
    if os.path.exists(out):
        print("exists", out)
        return
    t = time.time()
    if mode == "generate":
        size, quality, prompt = sys.argv[3:6]
        res = post("https://api.openai.com/v1/images/generations",
                   json.dumps({"model": MODEL, "prompt": prompt, "size": size, "quality": quality, "n": 1}).encode(), "application/json")
    else:
        src, size, quality, prompt = sys.argv[3:7]
        body, ct = multipart({"model": MODEL, "prompt": prompt, "size": size, "quality": quality, "n": "1"}, [("image[]", src)])
        res = post("https://api.openai.com/v1/images/edits", body, ct)
    open(out, "wb").write(base64.b64decode(res["data"][0]["b64_json"]))
    with open(LOG, "a") as log:
        log.write(json.dumps({"out": out, "mode": mode, "model": MODEL, "seconds": round(time.time() - t), "usage": res.get("usage")}) + "\n")
    print("wrote", out, res.get("usage"))


main()
