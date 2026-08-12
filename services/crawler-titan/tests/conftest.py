import logging
import os
import time

LOG_DIR = os.path.join(os.path.dirname(__file__), "output", "logs")


def pytest_sessionstart(session):
    os.makedirs(LOG_DIR, exist_ok=True)

    log_file = os.path.join(LOG_DIR, f"test_{time.strftime('%Y%m%d_%H%M%S')}.log")

    file_handler = logging.FileHandler(log_file, encoding="utf-8")
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    ))

    root = logging.getLogger()
    root.setLevel(logging.DEBUG)
    root.addHandler(file_handler)

    logging.info("=" * 60)
    logging.info("Test session started")
    logging.info(f"Log file: {log_file}")
    logging.info("=" * 60)


def pytest_sessionfinish(session):
    logging.info("=" * 60)
    logging.info("Test session finished")
    logging.info("=" * 60)
