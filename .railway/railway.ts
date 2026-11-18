// Railway project "lifestory-kidsbooks", environment "production" (Railway Infrastructure as Code).
// Preview with `railway config plan`, apply with `railway config apply`; deploy code with
// `railway up`. See README "Deploying". The images and their environment are host-agnostic;
// this file only wires them to Railway's Postgres and bucket.
import { bucket, defineRailway, postgres, preserve, project, ref, service } from "railway/iac";

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
    // "fake" until the Modal provider ships; switching to "modal" also needs its MODAL_* variables.
    IMAGE_PROVIDER: "fake",
  };

  const web = service("web", {
    build: { builder: "DOCKERFILE", dockerfilePath: "apps/web/Dockerfile" },
    preDeploy: "node packages/db/src/migrate.ts",
    healthcheck: "/api/health",
    env: {
      ...appEnv,
      BETTER_AUTH_URL: "https://${{RAILWAY_PUBLIC_DOMAIN}}",
      // Set once with `railway variables --service web --set BETTER_AUTH_SECRET=...`; never in this file.
      BETTER_AUTH_SECRET: preserve(),
    },
  });

  const worker = service("worker", {
    build: { builder: "DOCKERFILE", dockerfilePath: "apps/worker/Dockerfile" },
    env: { ...appEnv, BETTER_AUTH_SECRET: web.env.BETTER_AUTH_SECRET },
  });

  return project("lifestory-kidsbooks", { resources: [db, data, web, worker] });
});
