import unittest
from install import nginx_include


class NginxTest(unittest.TestCase):
    def test_scoped_and_idempotent(self):
        other = "server {\n server_name other.example;\n listen 443 ssl;\n}\n"
        http = "server {\n server_name csc-sys.cdm.depaul.edu;\n listen 80;\n}\n"
        https = "server {\n server_name csc-sys.cdm.depaul.edu;\n location / {\n  try_files $uri =404;\n }\n listen 443 ssl;\n}\n"
        text = other + http + https
        result = nginx_include(text)
        self.assertTrue(result.startswith(other + http))
        self.assertEqual(result.count("include /etc/nginx/snippets/exam-ssh-relay.conf;"), 1)
        self.assertEqual(nginx_include(result), result)

    def test_ambiguous_or_missing_fail(self):
        https = "server {\n server_name csc-sys.cdm.depaul.edu;\n listen 443 ssl;\n}\n"
        for text in ["", https + https, https + "server {\n"]:
            with self.assertRaises(ValueError):
                nginx_include(text)


if __name__ == "__main__":
    unittest.main()
