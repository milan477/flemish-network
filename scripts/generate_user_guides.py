#!/usr/bin/env python3
"""Generate the English and Dutch PDF user guides from their Markdown sources."""

from __future__ import annotations

import argparse
import html
import re
from dataclasses import dataclass, field
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Paragraph


ROOT = Path(__file__).resolve().parents[1]
SCREENSHOT_DIR = ROOT / "tmp" / "pdfs" / "guide-screenshots"
OUTPUT_DIR = ROOT / "output" / "pdf"

YELLOW = HexColor("#FACC15")
YELLOW_LIGHT = HexColor("#FEFCE8")
YELLOW_BORDER = HexColor("#FDE047")
INK = HexColor("#111827")
MUTED = HexColor("#6B7280")
LIGHT_BORDER = HexColor("#E5E7EB")
WHITE = HexColor("#FFFFFF")


@dataclass
class Section:
    title: str
    purpose: str = ""
    preface: list[str] = field(default_factory=list)
    steps: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


@dataclass
class Guide:
    title: str
    intro: str
    sections: list[Section]


def normalize_dashes(value: str) -> str:
    return value.replace("—", "-").replace("–", "-").replace("‑", "-")


def inline_markup(value: str) -> str:
    value = html.escape(normalize_dashes(value))
    value = re.sub(r"\*\*(.+?)\*\*", r'<font name="GuideSans-Bold">\1</font>', value)
    return re.sub(
        r"\[\[(.+?)\]\]",
        r'<span backColor="#FEF3C7" color="#92400E"><font name="GuideSans-Bold">&nbsp;\1&nbsp;</font></span>',
        value,
    )


def plain_text(value: str) -> str:
    value = re.sub(r"\*\*(.+?)\*\*", r"\1", value)
    value = re.sub(r"\[\[(.+?)\]\]", r"\1", value)
    return normalize_dashes(value).strip()


def parse_guide(path: Path) -> Guide:
    lines = path.read_text(encoding="utf-8").splitlines()
    title = plain_text(lines[0].removeprefix("# "))
    intro_lines: list[str] = []
    sections: list[Section] = []
    current: Section | None = None
    seen_step = False

    for raw in lines[1:]:
        line = raw.strip()
        if not line:
            continue
        if line.startswith("## "):
            current = Section(title=plain_text(line[3:]))
            sections.append(current)
            seen_step = False
            continue
        if current is None:
            intro_lines.append(line)
            continue
        if line.startswith("**Purpose:**") or line.startswith("**Doel:**"):
            current.purpose = line.split("**", 2)[-1].strip()
            continue
        step_match = re.match(r"^\d+\.\s+(.*)$", line)
        if step_match:
            current.steps.append(step_match.group(1))
            seen_step = True
            continue
        if line.startswith("- "):
            current.notes.append(line[2:])
        elif seen_step:
            current.notes.append(line)
        else:
            current.preface.append(line)

    return Guide(title=title, intro=" ".join(intro_lines), sections=sections)


def register_fonts() -> None:
    font_dir = Path("/System/Library/Fonts/Supplemental")
    pdfmetrics.registerFont(TTFont("GuideSans", str(font_dir / "Arial.ttf")))
    pdfmetrics.registerFont(TTFont("GuideSans-Bold", str(font_dir / "Arial Bold.ttf")))


def paragraph_style(name: str, size: float, leading: float, color=INK, bold: bool = False) -> ParagraphStyle:
    return ParagraphStyle(
        name,
        fontName="GuideSans-Bold" if bold else "GuideSans",
        fontSize=size,
        leading=leading,
        textColor=color,
        alignment=TA_LEFT,
        spaceAfter=0,
        spaceBefore=0,
    )


TITLE_STYLE = paragraph_style("SectionTitle", 21, 24, bold=True)
PURPOSE_STYLE = paragraph_style("Purpose", 10, 13, bold=True)
BODY_STYLE = paragraph_style("Body", 9, 11.5)
NOTE_STYLE = paragraph_style("Note", 8.3, 10.5, color=HexColor("#713F12"))
INTRO_STYLE = paragraph_style("Intro", 11, 15, color=HexColor("#374151"))


def draw_paragraph(canvas: Canvas, text: str, style: ParagraphStyle, x: float, top: float, width: float) -> float:
    paragraph = Paragraph(inline_markup(text), style)
    _, height = paragraph.wrap(width, 1000)
    paragraph.drawOn(canvas, x, top - height)
    return height


def draw_header(canvas: Canvas, page_number: int, page_count: int) -> None:
    width, height = A4
    canvas.setFont("GuideSans-Bold", 8)
    canvas.setFillColor(HexColor("#374151"))
    canvas.drawString(40, height - 27, "FLEMISH NETWORK")
    if page_number > 1:
        canvas.setFont("GuideSans", 8)
        canvas.setFillColor(MUTED)
        canvas.drawRightString(width - 40, height - 27, f"{page_number} / {page_count}")


def draw_screenshot(canvas: Canvas, image_path: Path, top: float) -> float:
    width, _ = A4
    image_width = 500
    image_height = image_width * 9 / 16
    x = (width - image_width) / 2
    y = top - image_height
    canvas.setStrokeColor(LIGHT_BORDER)
    canvas.setLineWidth(0.8)
    canvas.roundRect(x - 1, y - 1, image_width + 2, image_height + 2, 5, stroke=1, fill=0)
    canvas.drawImage(ImageReader(image_path), x, y, image_width, image_height, preserveAspectRatio=True, mask="auto")
    return y


def draw_cover(canvas: Canvas, guide: Guide, screenshot: Path, language: str, page_count: int) -> None:
    width, height = A4
    draw_header(canvas, 1, page_count)
    canvas.setFillColor(INK)
    canvas.setFont("GuideSans-Bold", 28)
    canvas.drawString(40, height - 95, normalize_dashes(guide.title))
    canvas.setFont("GuideSans", 12)
    canvas.setFillColor(MUTED)
    subtitle = "Current interface / Page-by-page instructions" if language == "en" else "Huidige interface / Instructies per pagina"
    canvas.drawString(40, height - 122, subtitle)
    image_bottom = draw_screenshot(canvas, screenshot, height - 155)
    y = image_bottom - 34
    draw_paragraph(canvas, guide.intro, INTRO_STYLE, 40, y, width - 80)
    canvas.setFillColor(YELLOW_LIGHT)
    canvas.setStrokeColor(YELLOW_BORDER)
    canvas.roundRect(40, 52, width - 80, 48, 7, stroke=1, fill=1)
    canvas.setFont("GuideSans-Bold", 7.3)
    canvas.setFillColor(HexColor("#92400E"))
    canvas.drawString(54, 85, "DEFINITION" if language == "en" else "DEFINITIE")
    note = (
        "Network: the main directory of people and organizations, including their locations and retained sources."
        if language == "en"
        else "Network: de hoofdlijst van personen en organisaties, met hun locaties en bewaarde bronnen."
    )
    draw_paragraph(canvas, note, NOTE_STYLE, 54, 76, width - 108)


def draw_section(canvas: Canvas, section: Section, screenshot: Path, page_number: int, page_count: int, language: str) -> None:
    width, height = A4
    draw_header(canvas, page_number, page_count)
    y = height - 62
    y -= draw_paragraph(canvas, section.title, TITLE_STYLE, 40, y, width - 80)
    y -= 16
    y = draw_screenshot(canvas, screenshot, y)
    y -= 22

    canvas.setFont("GuideSans-Bold", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(40, y, "PURPOSE" if language == "en" else "DOEL")
    y -= 8
    y -= draw_paragraph(canvas, section.purpose, PURPOSE_STYLE, 40, y, width - 80)
    y -= 20

    if section.preface:
        canvas.setFont("GuideSans-Bold", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(40, y, "OVERVIEW" if language == "en" else "OVERZICHT")
        y -= 10
        y -= draw_paragraph(canvas, " ".join(section.preface), BODY_STYLE, 40, y, width - 80)
        y -= 18

    canvas.setFont("GuideSans-Bold", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(40, y, "HOW TO USE" if language == "en" else "ZO GEBRUIK JE DIT")
    y -= 11

    for index, step in enumerate(section.steps, start=1):
        canvas.setFillColor(YELLOW)
        canvas.circle(49, y - 7, 8, stroke=0, fill=1)
        canvas.setFillColor(INK)
        canvas.setFont("GuideSans-Bold", 8)
        canvas.drawCentredString(49, y - 10, str(index))
        step_height = draw_paragraph(canvas, step, BODY_STYLE, 67, y, width - 107)
        y -= max(17, step_height) + 6

    if section.notes:
        note_text = " &middot; ".join(inline_markup(note) for note in section.notes)
        paragraph = Paragraph(note_text, NOTE_STYLE)
        _, note_height = paragraph.wrap(width - 108, 1000)
        box_height = note_height + 31
        box_y = max(38, y - box_height - 1)
        canvas.setFillColor(YELLOW_LIGHT)
        canvas.setStrokeColor(YELLOW_BORDER)
        canvas.roundRect(40, box_y, width - 80, box_height, 7, stroke=1, fill=1)
        canvas.setFont("GuideSans-Bold", 7.3)
        canvas.setFillColor(HexColor("#92400E"))
        canvas.drawString(54, box_y + box_height - 13, "DEFINITION" if language == "en" else "DEFINITIE")
        paragraph.drawOn(canvas, 54, box_y + 9)


def build_pdf(source: Path, destination: Path, language: str) -> None:
    guide = parse_guide(source)
    screenshots = sorted(SCREENSHOT_DIR.glob("page-*.png"))
    page_count = len(guide.sections) + 1
    if len(screenshots) < page_count:
        raise RuntimeError(f"Expected {page_count} screenshots, found {len(screenshots)}")

    destination.parent.mkdir(parents=True, exist_ok=True)
    canvas = Canvas(str(destination), pagesize=A4)
    canvas.setTitle(normalize_dashes(guide.title))
    canvas.setAuthor("Flemish Network")
    canvas.setSubject("Current interface user guide with application screenshots")

    draw_cover(canvas, guide, screenshots[0], language, page_count)
    canvas.showPage()
    for index, section in enumerate(guide.sections, start=2):
        draw_section(canvas, section, screenshots[index - 1], index, page_count, language)
        canvas.showPage()
    canvas.save()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--language", choices=("en", "nl", "both"), default="both")
    args = parser.parse_args()
    register_fonts()

    if args.language in {"en", "both"}:
        build_pdf(
            ROOT / "docs" / "USER-GUIDE-EN.md",
            OUTPUT_DIR / "flemish-network-user-guide-en.pdf",
            "en",
        )
    if args.language in {"nl", "both"}:
        build_pdf(
            ROOT / "docs" / "USER-GUIDE-NL.md",
            OUTPUT_DIR / "flemish-network-gebruikershandleiding-nl.pdf",
            "nl",
        )


if __name__ == "__main__":
    main()
