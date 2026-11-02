// file: 로 설치한 @packages/* 사본이 레포의 원본과 같은지 본다. 다르면 옛 코드로 빌드·배포되므로 멈춘다.
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const pkg = JSON.parse(readFileSync(path.join(appDir, "package.json"), "utf8"))

function listFiles(dir, base = dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (name === "node_modules") return []
    return statSync(full).isDirectory()
      ? listFiles(full, base)
      : [path.relative(base, full)]
  })
}

const stale = []
for (const [name, spec] of Object.entries(pkg.dependencies ?? {})) {
  if (!spec.startsWith("file:")) continue
  const source = path.resolve(appDir, spec.slice("file:".length))
  const installed = path.join(appDir, "node_modules", name)
  let installedFiles
  try {
    installedFiles = listFiles(installed)
  } catch {
    stale.push(`${name}: 설치되지 않았다`)
    continue
  }
  const sourceFiles = listFiles(source)
  const same =
    sourceFiles.length === installedFiles.length &&
    sourceFiles.every((file) => {
      try {
        return readFileSync(path.join(source, file)).equals(
          readFileSync(path.join(installed, file))
        )
      } catch {
        return false
      }
    })
  if (!same) stale.push(`${name}: ${spec} 와 다르다`)
}

if (stale.length > 0) {
  console.error(
    [
      "node_modules 의 로컬 패키지 사본이 원본과 다릅니다. web/auth-web 에서 rm -rf node_modules/@packages && npm install 을 실행하세요(그냥 npm install 은 버전이 같으면 사본을 갈지 않는다).",
      ...stale.map((line) => `  - ${line}`),
    ].join("\n")
  )
  process.exit(1)
}
