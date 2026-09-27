"""Command-line entry point for RoboZ's dotenv encryption."""

import argparse
import os
from getpass import getpass

from roboz.endpoints import encrypt_env


def main() -> None:
    parser = argparse.ArgumentParser(description="Encrypt *_SECRET credentials")
    parser.add_argument("command", choices=["encrypt"])
    parser.add_argument("path", nargs="?", default=".env")
    args = parser.parse_args()
    password = os.environ.pop("ROBOZ_ENV_PASSWORD", None)
    if password is None:
        password = getpass("Encryption password: ")
        if password != getpass("Confirm password: "):
            raise ValueError("Passwords do not match")
    output = encrypt_env(args.path, password=password)
    print(f"Encrypted credentials: {output}")


if __name__ == "__main__":
    main()
