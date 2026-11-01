"""Обновляет опрос одной командой: итоги, слайд 7, презентация в pptx и pdf (нужен PowerPoint), папка для Диска.

Запуск: python tools/update_survey.py <выгрузка.xlsx> [--paid 100] [--exclude 7 12] [--quote "цитата"] [--folder "папка для Диска"]
После этого на Диске нужно заменить три файла с теми же названиями: презентацию pptx и pdf, ИТОГИ ОПРОСА.md.
"""
import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NAME = "ПРЕЗЕНТАЦИЯ ОПЛАТА ВОВРЕМЯ"
PDF = """$p = New-Object -ComObject PowerPoint.Application
try { $d = $p.Presentations.Open('{src}', $true, $false, $false); $d.SaveAs('{dst}', 32); $d.Close() } finally { $p.Quit() }"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--paid", default="0")
    ap.add_argument("--exclude", nargs="*", default=[])
    ap.add_argument("--quote", action="append", default=[])
    ap.add_argument("--folder", default=str(ROOT.parents[1] / "загрузка_спринт1"))
    a = ap.parse_args()
    cmd = [sys.executable, str(ROOT / "tools" / "survey_results.py"), a.file, "--paid", a.paid, "--exclude", *a.exclude]
    for q in a.quote:
        cmd += ["--quote", q]
    subprocess.run(cmd, check=True)
    subprocess.run([sys.executable, str(ROOT / "tools" / "build_deck.py")], check=True)
    src, dst = ROOT / f"{NAME}.pptx", ROOT / f"{NAME}.pdf"
    subprocess.run(["powershell", "-NoProfile", "-Command", PDF.replace("{src}", str(src)).replace("{dst}", str(dst))], check=True)
    out = Path(a.folder)
    out.mkdir(parents=True, exist_ok=True)
    shutil.copy(src, out)
    shutil.copy(dst, out)
    (out / "ОТВЕТЫ ФОРМЫ").mkdir(exist_ok=True)
    shutil.copy(ROOT / "docs" / "research" / "custdev" / "survey_results.md", out / "ОТВЕТЫ ФОРМЫ" / "ИТОГИ ОПРОСА.md")
    print(f"\nГотово. Замените на Диске файлы из папки: {out}")


if __name__ == "__main__":
    main()
