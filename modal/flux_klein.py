"""FLUX 3 Image Klein on Modal: Lifestory's real image provider (docs/plan.md, "Generation workflow").

The app (packages/core/src/providers/modal.ts) POSTs a job to the `submit` web endpoint, signed with
MODAL_CALLBACK_SECRET. `submit` spawns `Klein.generate` on a GPU and returns at once. The GPU function downloads
the reference images from presigned GET URLs, generates with the prompt upsampler on, uploads the PNG to the
presigned PUT URL, and POSTs a signed callback to the app's /api/webhooks/modal, which resumes the waiting workflow.

Cost (docs/decisions.md D25): the GPU container scales to zero 60 s after its last job, and at most one runs at a
time, so jobs queue instead of fanning out. A cold job is ~US$0.09, a warm one ~US$0.014. Weights live on a Modal
Volume; fill it once on a CPU with `download_weights`. Every output passes BFL's NSFW classifier before upload
(FLUX Kommunity License §2e).

    modal run modal/flux_klein.py::download_weights   # once, ~40 GB onto the volume, no GPU
    modal deploy modal/flux_klein.py                  # prints the submit endpoint URL (MODAL_ENDPOINT_URL)
    modal run modal/flux_klein.py --prompt "..."      # one image to ./flux-klein.png, without the app

Secrets (Modal): `huggingface` with HF_TOKEN (an account that accepted the FLUX Kommunity License on
huggingface.co/black-forest-labs/flux-3-image-klein), and `lifestory-modal` with MODAL_CALLBACK_SECRET, the same
value as the app's MODAL_CALLBACK_SECRET. See the README, "Image generation on Modal".
"""

from __future__ import annotations  # FastAPI resolves `Request` inside the container, where it's imported

import hashlib
import hmac
import json
import os
import time

import modal

APP_NAME = "lifestory-flux-klein"
MODEL_REPO = "black-forest-labs/flux-3-image-klein"  # distilled checkpoint: 16 steps, no CFG
UPSAMPLER_REPO = "black-forest-labs/flux-3-image-klein-pup"  # required prompt upsampler (9B)
# The FLUX Kommunity License (§2e) requires content filtering of outputs; this is the classifier BFL's reference code loads.
SAFETY_REPO = "Falconsai/nsfw_image_detection"
NSFW_THRESHOLD = 0.5
# Appended to every prompt. Small faces in wide scenes often came out with mismatched or staring eyes, and the
# distilled checkpoint runs without CFG, so a negative prompt would do nothing; the upsampler carries this into the caption.
# It asks for consistency, not one eye state: a sleeping, winking, or laughing character keeps the expression asked for.
FACE_GUIDANCE = (
    "Draw every face with care and keep the expression the scene calls for, including closed, winking or squinting "
    "eyes. Both eyes match in size, shape and style and sit level on the face; open eyes look in the same direction, "
    "with clear irises and pupils."
)
CACHE_DIR = "/cache"
SIGNATURE_HEADER = "x-lifestory-signature"

app = modal.App(APP_NAME)
weights = modal.Volume.from_name("lifestory-flux-klein-weights", create_if_missing=True)
huggingface = modal.Secret.from_name("huggingface", required_keys=["HF_TOKEN"])
callback_secret = modal.Secret.from_name("lifestory-modal", required_keys=["MODAL_CALLBACK_SECRET"])

# Versions follow docs/decisions.md D16: latest stable release at least 3 days old, pinned exactly.
gpu_image = (
    modal.Image.debian_slim(python_version="3.12")
    .uv_pip_install(
        "torch==2.14.1",
        "torchvision==0.29.1",
        "diffusers==0.43.0",
        "transformers==5.23.0",
        "accelerate==1.15.0",
        "huggingface-hub==2.4.0",
        "pillow==13.0.0",
        "requests==2.34.2",
    )
    .env({"HF_HOME": f"{CACHE_DIR}/huggingface", "HF_XET_HIGH_PERFORMANCE": "1"})
)
web_image = modal.Image.debian_slim(python_version="3.12").uv_pip_install("fastapi==0.163.1")
with web_image.imports():
    from fastapi import HTTPException, Request


def sign(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


@app.function(image=gpu_image, volumes={CACHE_DIR: weights}, secrets=[huggingface], timeout=60 * 60)
def download_weights():
    """Fills the volume with both repositories on a CPU, so GPU cold starts only read local files."""
    from huggingface_hub import snapshot_download

    # The quantized variants and the BFL-layout root weights aren't used by Diffusers.
    snapshot_download(MODEL_REPO, ignore_patterns=["variants/*", "model.safetensors", "ae.safetensors", "*.jpg", "assets/*"])
    snapshot_download(UPSAMPLER_REPO)
    snapshot_download(SAFETY_REPO)
    weights.commit()


@app.cls(
    image=gpu_image,
    gpu="A100-80GB",  # all components in bf16 need ~39 GB plus activations
    volumes={CACHE_DIR: weights},
    secrets=[huggingface, callback_secret],
    scaledown_window=60,
    max_containers=1,
    timeout=20 * 60,
)
class Klein:
    @modal.enter()
    def load(self):
        import torch
        from diffusers import ModularPipeline
        from transformers import pipeline

        started = time.monotonic()
        self.pipe = ModularPipeline.from_pretrained(MODEL_REPO)
        self.pipe.load_components(dtype={"vae": torch.float32, "default": torch.bfloat16})
        self.pipe.to("cuda")
        self.safety = pipeline("image-classification", model=SAFETY_REPO, device="cuda")
        print(f"loaded {MODEL_REPO} in {time.monotonic() - started:.1f}s")

    @modal.method()
    def generate(self, job: dict) -> dict:
        """Renders one job and reports the outcome to the app. A failure is reported, then re-raised for the logs."""
        try:
            png, caption = self._render(job)
            import requests

            put = requests.put(job["outputUrl"], data=png, headers={"content-type": "image/png"}, timeout=120)
            put.raise_for_status()
            outcome = {"generationId": job["generationId"], "status": "succeeded", "contentType": "image/png"}
            print(f"{job['generationId']}: {len(png)} bytes; caption: {caption[:400]}")
        except Exception as error:
            _callback(job, {"generationId": job["generationId"], "status": "failed", "message": str(error)[:500]})
            raise
        _callback(job, outcome)
        return outcome

    @modal.method()
    def try_prompt(self, prompt: str, width: int, height: int, seed: int, references: list[bytes]) -> tuple[bytes, str]:
        """Renders without storage or callback, for `modal run modal/flux_klein.py --prompt ...`."""
        job = {"generationId": "try", "prompt": prompt, "width": width, "height": height, "seed": seed}
        return self._render(job, references)

    def _render(self, job: dict, reference_bytes: list[bytes] | None = None) -> tuple[bytes, str]:
        import io

        import requests
        import torch
        from PIL import Image

        width, height = int(job["width"]), int(job["height"])
        if reference_bytes is None:
            reference_bytes = [_get(requests, url) for url in job.get("references", [])]
        references = [Image.open(io.BytesIO(data)).convert("RGB") for data in reference_bytes]
        # The model works on a 16-pixel grid; generate on it, then resize to the size the app asked for.
        grid = lambda side: max(16, -(-side // 16) * 16)  # noqa: E731
        prompt = f"{job['prompt'].rstrip()} {FACE_GUIDANCE}"
        inputs = {"prompt": prompt, "height": grid(height), "width": grid(width)}
        if references:
            inputs["image"] = references
        started = time.monotonic()
        out = self.pipe(**inputs, generator=torch.Generator().manual_seed(int(job["seed"])), output=["images", "prompt"])
        image = out["images"][0]
        print(f"{job['generationId']}: generated {image.size} in {time.monotonic() - started:.1f}s")
        nsfw = next((r["score"] for r in self.safety(image) if r["label"] == "nsfw"), 0.0)
        if nsfw >= NSFW_THRESHOLD:
            raise ContentFiltered(f"output blocked by the content filter (nsfw score {nsfw:.2f})")
        if image.size != (width, height):
            image = image.resize((width, height), Image.Resampling.LANCZOS)
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        caption = out["prompt"]
        return buffer.getvalue(), caption[0] if isinstance(caption, list) else str(caption)


class ContentFiltered(Exception):
    pass


@app.local_entrypoint()
def main(prompt: str, width: int = 1024, height: int = 768, seed: int = 1, out: str = "flux-klein.png", reference: str = ""):
    """Generates one image on the GPU and saves it locally: a check that needs no app. `--reference a.png,b.png`
    passes local files as references, which the prompt can cite as <ref_image_0>, <ref_image_1>, ..."""
    references = [open(path, "rb").read() for path in reference.split(",") if path]
    png, caption = Klein().try_prompt.remote(prompt, width, height, seed, references)
    with open(out, "wb") as file:
        file.write(png)
    print(f"saved {out} ({len(png)} bytes)\nupsampled caption: {caption}")


def _get(requests, url: str) -> bytes:
    response = requests.get(url, timeout=60)
    response.raise_for_status()
    return response.content


def _callback(job: dict, outcome: dict) -> None:
    """POSTs the signed outcome to the app, retrying for about a minute. The app ignores duplicates."""
    import requests

    body = json.dumps(outcome).encode()
    headers = {"content-type": "application/json", SIGNATURE_HEADER: sign(os.environ["MODAL_CALLBACK_SECRET"], body)}
    for attempt in range(6):
        try:
            response = requests.post(job["callbackUrl"], data=body, headers=headers, timeout=30)
            if response.status_code < 500:
                print(f"{job['generationId']}: callback {response.status_code}")
                return
        except requests.RequestException as error:
            print(f"{job['generationId']}: callback attempt {attempt + 1} failed: {error}")
        time.sleep(2**attempt)
    raise RuntimeError(f"callback to {job['callbackUrl']} failed")


@app.function(image=web_image, secrets=[callback_secret])
@modal.fastapi_endpoint(method="POST")
async def submit(request: Request):
    """Accepts a signed job and spawns it on the GPU. A repeated generationId returns the first call."""
    body = await request.body()
    expected = sign(os.environ["MODAL_CALLBACK_SECRET"], body)
    if not hmac.compare_digest(expected, request.headers.get(SIGNATURE_HEADER, "")):
        raise HTTPException(status_code=401, detail="bad signature")
    job = json.loads(body)
    calls = modal.Dict.from_name("lifestory-flux-klein-calls", create_if_missing=True)
    existing = await calls.get.aio(job["generationId"])
    if existing:
        return {"generationId": job["generationId"], "callId": existing, "duplicate": True}
    call = await Klein().generate.spawn.aio(job)
    await calls.put.aio(job["generationId"], call.object_id)
    return {"generationId": job["generationId"], "callId": call.object_id, "duplicate": False}
