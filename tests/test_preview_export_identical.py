import io
import json
import unittest
import zipfile

import app as config_app


class TestPreviewExportIdentical(unittest.TestCase):
    def setUp(self):
        self.client = config_app.app.test_client()
        self.project = {
            "schema_version": 3, "device": "TMS320F28034", "package": "PNT80",
            "system_clock": None,
            "pins": {
                "34": {
                    "physical_pin": 34, "signal": "GPIO29", "gpio_num": 29,
                    "mux": 2, "function": "SCLA", "type": "i2c",
                    "electrical_profile": "i2c_scla",
                }
            },
            "pwm_modules": {}, "adc": None, "timers": {}, "protection": None,
        }

    def test_every_preview_file_equals_zip_member(self):
        preview_response = self.client.post(
            "/api/preview", json={"project_config": self.project, "active_module": "SCLA"})
        self.assertEqual(preview_response.status_code, 200, preview_response.get_data(as_text=True))
        preview = preview_response.get_json()
        zip_response = self.client.post("/api/export.zip", json={"project_config": self.project})
        self.assertEqual(zip_response.status_code, 200)
        with zipfile.ZipFile(io.BytesIO(zip_response.data)) as archive:
            self.assertEqual(set(archive.namelist()), set(preview["files"]))
            for name, text in preview["files"].items():
                self.assertEqual(archive.read(name), text.encode("utf-8"), name)


if __name__ == "__main__":
    unittest.main()
