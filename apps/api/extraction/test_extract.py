import io
import unittest
import zipfile
from pypdf import PdfWriter
from pypdf.generic import NameObject, DecodedStreamObject, DictionaryObject
from extract import extract


def pdf(operations):
    writer = PdfWriter()
    for data in operations:
        page = writer.add_blank_page(width=320, height=320)
        font = DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")})
        page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})})
        stream = DecodedStreamObject()
        stream.set_data(data)
        page[NameObject("/Contents")] = writer._add_object(stream)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


class SourceTests(unittest.TestCase):
    def test_pdf_page_numbers_include_non_text_pages(self):
        graphic = b"0 0 100 100 re f"
        result = extract(pdf([graphic, b"BT /F1 12 Tf (page two) Tj ET"]), ".pdf")
        self.assertEqual(result["segments"], [dict(unit="page", start=2, end=2, text="page two")])
        self.assertEqual(extract(pdf([graphic]), ".pdf")["status"], "empty")

    def test_docx_body_paragraph_numbers_include_blanks_and_tables(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/><w:tbl><w:tr><w:tc><w:p><w:r><w:t>본문</w:t><w:tab/><w:t>둘</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>')
        self.assertEqual(extract(buf.getvalue(), ".docx")["segments"], [dict(unit="paragraph",start=2,end=2,text="본문\t둘")])

    def test_text_and_markdown_line_ranges(self):
        for extension, encoding in [(".txt","utf-16"),(".md","utf-8-sig")]:
            sections = extract("\r\n# 제목\r\n한글\r\n\r\n끝".encode(encoding),extension)["segments"]
            self.assertEqual([(s["start"],s["end"],s["text"]) for s in sections], [(2,3,"# 제목\n한글"),(5,5,"끝")])


if __name__ == "__main__":
    unittest.main()
