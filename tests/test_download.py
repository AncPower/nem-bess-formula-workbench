import importlib.util
import unittest
import io
import tempfile
import zipfile
from pathlib import Path
from unittest.mock import patch
from datetime import date

spec = importlib.util.spec_from_file_location("download", "analysis/download.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DownloadTests(unittest.TestCase):
    def test_download_cache_and_network_failure(self):
        content = io.BytesIO()
        with zipfile.ZipFile(content, "w") as archive:
            archive.writestr("prices.CSV", "I,TRADING,PRICE,3,SETTLEMENTDATE,REGIONID,RRP,INVALIDFLAG,PRICE_STATUS\nD,TRADING,PRICE,3,2026/07/01 00:05:00,NSW1,50,0,FIRM\n")
        with tempfile.TemporaryDirectory() as folder:
            cache = Path(folder)
            with patch.object(module, "urlopen", return_value=io.BytesIO(content.getvalue())) as fetch:
                result = module.download(date(2026, 7, 1), date(2026, 7, 1), cache)
                self.assertEqual(len(result["prices"]), 1)
                module.download(date(2026, 7, 1), date(2026, 7, 1), cache)
                self.assertEqual(fetch.call_count, 1)
            with patch.object(module, "urlopen", side_effect=OSError("404")):
                with self.assertRaises(OSError):
                    module.download(date(2026, 8, 1), date(2026, 8, 1), cache)
            self.assertTrue((cache / "2026-07.zip").exists())

    def test_urls(self):
        self.assertIn("PUBLIC_DVD", module.archive_url(2024, 7))
        self.assertIn("PUBLIC_ARCHIVE%23TRADINGPRICE", module.archive_url(2024, 8))

    def test_filter_conflict_and_midnight(self):
        header = ["I", "TRADING", "PRICE", "3", "SETTLEMENTDATE", "REGIONID", "RRP", "INVALIDFLAG", "PRICE_STATUS"]
        def row(price, region="NSW1"):
            return ["D", "TRADING", "PRICE", "3", "2026/08/01 00:00:00", region, price, "0", "FIRM"]
        prices = {}
        module.parse_rows([header, row("100"), row("5", "QLD1")], prices, date(2026, 7, 31), date(2026, 7, 31))
        self.assertEqual(prices, {"2026-08-01T00:00": 100})
        with self.assertRaisesRegex(ValueError, "Conflicting"):
            module.parse_rows([header, row("101")], prices, date(2026, 7, 31), date(2026, 7, 31))
        with self.assertRaises(ValueError):
            module.parse_rows([header, row("NaN")], {}, date(2026, 7, 31), date(2026, 7, 31))
        with self.assertRaises(ValueError):
            module.parse_rows([row("100")], {}, date(2026, 7, 31), date(2026, 7, 31))


if __name__ == "__main__":
    unittest.main()
