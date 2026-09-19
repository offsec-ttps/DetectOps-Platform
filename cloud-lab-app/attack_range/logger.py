"""
Logging setup for Attack Range.

Creates a shared logging object used by the controller and managers.
"""

import logging


def setup_logging(log_path: str, log_level: str):
    """
    Creates a shared logging object for the application.

    :param log_path: Log file path
    :param log_level: Log level (e.g. 'INFO', 'DEBUG')
    :return: Configured Logger instance
    """
    logger = logging.getLogger("attack_range")
    logger.setLevel(log_level)
    fh = logging.FileHandler(log_path)
    fh.setLevel(log_level)
    ch = logging.StreamHandler()
    ch.setLevel(log_level)
    formatter = logging.Formatter("%(asctime)s - %(levelname)s - %(name)s - %(message)s")
    fh.setFormatter(formatter)
    ch.setFormatter(formatter)
    logger.addHandler(fh)
    logger.addHandler(ch)
    return logger
