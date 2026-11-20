// Railway project "lifestory-kidsbooks", environment "production" (Railway Infrastructure as Code).
// Preview with `railway config plan`, apply with `railway config apply`. Code deploys itself: both services
// build every push to `main` once its GitHub checks pass. See README "Deploying". The images and their
// environment are host-agnostic; this file only wires them to Railway's Postgres and bucket.
import { bucket, defineRailway, github, postgres, preserve, project, ref, service } from "railway/iac";

export default defineRailway(() => {
  const db = postgres("postgres");
  // Created in the dashboard: project tokens can't create buckets.
  const data = bucket("lifestory-data", { region: "iad" });

  // Shared by the web app and the worker; names match .env.example.
  const appEnv = {
    DATABASE_URL: db.env.DATABASE_URL,
    S3_ENDPOINT: ref(data, "ENDPOINT"),
    S3_REGION: ref(data, "REGION"),
    S3_BUCKET: ref(data, "BUCKET"),
    S3_ACCESS_KEY_ID: ref(data, "ACCESS_KEY_ID"),
    S3_SECRET_ACCESS_KEY: ref(data, "SECRET_ACCESS_KEY"),
    // Railway buckets use virtual-hosted-style URLs.
    S3_FORCE_PATH_STYLE: "false",
    // OpenAI edits story parts (D30, D36); "modal" is the fallback and needs its MODAL_* variables instead.
    IMAGE_PROVIDER: "openai",
    // Casting suggestions read uploaded page art with OpenAI vision (OPENAI_CASTING_MODEL defaults to gpt-6.2-sol).
    CASTING_PROVIDER: "openai",
  };

  // Each push to main deploys both services, after CI passes (checkSuites).
  const source = github("sidpalas/lifestory-kidsbooks", { branch: "main", checkSuites: true });
  // Both services run it, since either may start first; migrate.ts holds a lock, so concurrent runs are safe.
  const preDeploy = "node packages/db/src/migrate.ts";

  const web = service("web", {
    source,
    build: { builder: "DOCKERFILE", dockerfilePath: "apps/web/Dockerfile" },
    preDeploy,
    healthcheck: "/api/health",
    env: {
      ...appEnv,
      // Railway injects PORT (8080) at runtime but doesn't expose it to references; declared so the worker's
      // PRINT_APP_URL can use ${{web.PORT}}. The custom domain targets 8080 too.
      PORT: "8080",
      BETTER_AUTH_URL: "https://${{RAILWAY_PUBLIC_DOMAIN}}",
      // Set once with `railway variables --service web --set BETTER_AUTH_SECRET=...`; never in this file.
      BETTER_AUTH_SECRET: preserve(),
      // Set once with `railway variables --service web --set OPENAI_API_KEY=...` before applying (README "Railway").
      OPENAI_API_KEY: preserve(),
      // Invitations and set-password links go out with Resend from the domain verified there (D39; README "Email").
      EMAIL_PROVIDER: "resend",
      EMAIL_FROM: "Lifestory <hello@mail.devopsdirective.com>",
      // Set once with `railway variables --service web --set RESEND_API_KEY=... --skip-deploys`; never in this file.
      RESEND_API_KEY: preserve(),
    },
  });

  const worker = service("worker", {
    source,
    build: { builder: "DOCKERFILE", dockerfilePath: "apps/worker/Dockerfile" },
    preDeploy,
    env: {
      ...appEnv,
      BETTER_AUTH_SECRET: web.env.BETTER_AUTH_SECRET,
      OPENAI_API_KEY: web.env.OPENAI_API_KEY,
      // Headless Chromium on the worker opens the web app's print page for PDF proofs (D27), over the private network.
      PRINT_APP_URL: "http://${{web.RAILWAY_PRIVATE_DOMAIN}}:${{web.PORT}}",
    },
  });

  return project("lifestory-kidsbooks", { resources: [db, data, web, worker] });
});
