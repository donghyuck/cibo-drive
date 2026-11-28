import base64
import io
import zipfile
from PIL import Image, ImageOps
from ebook import Book

def thumbnail(data, extension):
    if extension == ".pdf":
        import pypdfium2 as pdfium
        with pdfium.PdfDocument(data) as pdf:
            page = pdf[0]
            width, height = page.get_size()
            bitmap = page.render(scale=min(1, 300/max(width,height)))
            image = bitmap.to_pil().copy()
    else:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            if extension == ".epub":
                raw = Book(archive).cover()
            else:
                path = next((n for n in archive.namelist() if n.lower() in ("docprops/thumbnail.jpeg","docprops/thumbnail.jpg","docprops/thumbnail.png")),None)
                raw = archive.read(path) if path and archive.getinfo(path).file_size<=8<<20 else None
            if not raw: return None
            with Image.open(io.BytesIO(raw)) as original:
                if original.width*original.height>12_000_000: return None
                original.thumbnail((300,300))
                image = ImageOps.exif_transpose(original)
    output = io.BytesIO()
    image.convert("RGB").save(output,format="JPEG",quality=76)
    return base64.b64encode(output.getvalue()).decode("ascii") if output.tell()<=65536 else None
