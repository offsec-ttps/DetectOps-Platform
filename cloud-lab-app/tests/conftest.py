import logging
import os
import pytest


@pytest.fixture
def aws_credentials():
    """Mock AWS credentials for moto."""
    os.environ["AWS_ACCESS_KEY_ID"] = "testing"
    os.environ["AWS_SECRET_ACCESS_KEY"] = "testing"
    os.environ["AWS_SECURITY_TOKEN"] = "testing"
    os.environ["AWS_SESSION_TOKEN"] = "testing"
    os.environ["AWS_DEFAULT_REGION"] = "us-west-2"


@pytest.fixture
def mock_logger():
    """Create a logger for testing."""
    logger = logging.getLogger("test_attack_range")
    logger.setLevel(logging.DEBUG)
    return logger


@pytest.fixture
def aws_config():
    """Sample AWS config for testing."""
    return {
        "general": {
            "cloud_provider": "aws",
            "attack_range_id": "test-range-123",
        },
        "aws": {
            "region": "us-west-2",
        },
        "attack_range": [],
    }


@pytest.fixture
def aws_config_us_east_1():
    """Sample AWS config for us-east-1 region testing."""
    return {
        "general": {
            "cloud_provider": "aws",
            "attack_range_id": "test-range-123",
        },
        "aws": {
            "region": "us-east-1",
        },
        "attack_range": [],
    }


@pytest.fixture
def aws_backend_context(aws_credentials, aws_config, mock_logger, tmp_path):
    """Create an AWS provider + backend manager test context."""
    # Keep provider/manager imports lazy so test-only module mocks can be applied first.
    import sys
    from unittest.mock import MagicMock

    sys.modules["ansible_runner"] = MagicMock()
    sys.modules["python_vagrant"] = MagicMock()

    from attack_range.cloud_providers.aws_provider import AWSProvider
    from attack_range.managers.backend_manager import BackendManager

    provider = AWSProvider(aws_config, mock_logger)
    manager = BackendManager(
        terraform_dir=str(tmp_path),
        config=aws_config,
        config_path=str(tmp_path / "config.yml"),
        cloud_provider=provider,
        logger=mock_logger,
    )
    backend_name = "terraform-state-test-range-123"
    return {
        "provider": provider,
        "manager": manager,
        "region": "us-west-2",
        "bucket_name": provider.sanitize_name(backend_name),
        "table_name": provider.sanitize_name(backend_name),
        "tmp_path": tmp_path,
    }
