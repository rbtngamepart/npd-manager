# 크롬 확장 프로그램 폴더(extension/)를 public/npd-calendar-extension.zip 으로 묶음
# extension/ 를 고친 뒤:  python3 scripts/zip_extension.py
import os, zipfile
root = os.path.join(os.path.dirname(__file__), "..")
src = os.path.join(root, "extension")
out = os.path.join(root, "public", "npd-calendar-extension.zip")
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for d, _, files in os.walk(src):
        for f in sorted(files):
            p = os.path.join(d, f)
            z.write(p, os.path.join("npd-calendar-extension", os.path.relpath(p, src)))
print("만듦:", out)
