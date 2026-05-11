import json
import logging
import sys

DETAILED_FORMAT = "%(asctime)s | %(levelname)-8s | %(name)s:%(lineno)d | %(message)s"
SIMPLE_FORMAT = "%(levelname)s | %(message)s"


class StructuredFormatter(logging.Formatter):
    """JSON formatter that includes extra fields from log records."""

    def format(self, record):
        log_data = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        # Include extra fields if present
        if hasattr(record, "request_id"):
            log_data["request_id"] = record.request_id
        if hasattr(record, "method"):
            log_data["method"] = record.method
        if hasattr(record, "path"):
            log_data["path"] = record.path
        if hasattr(record, "client_ip"):
            log_data["client_ip"] = record.client_ip
        if hasattr(record, "status_code"):
            log_data["status_code"] = record.status_code
        if hasattr(record, "duration_ms"):
            log_data["duration_ms"] = record.duration_ms
        if hasattr(record, "error_type"):
            log_data["error_type"] = record.error_type
        if hasattr(record, "error_message"):
            log_data["error_message"] = record.error_message

        return json.dumps(log_data)


def setup_logging(debug: bool = False):

    level = logging.DEBUG if debug else logging.INFO

    # Use structured JSON format in production, detailed format in debug
    formatter = DETAILED_FORMAT if debug else StructuredFormatter()

    handler = logging.StreamHandler(sys.stdout)
    if isinstance(formatter, str):
        handler.setFormatter(logging.Formatter(formatter))
    else:
        handler.setFormatter(formatter)

    logging.basicConfig(level=level, handlers=[handler])

    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("openai").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)

    logger = logging.getLogger("unt_platform")
    logger.setLevel(level)

    return logger


def get_logger(name: str) -> logging.Logger:

    return logging.getLogger(f"unt_platform.{name}")


app_logger = setup_logging()
