"""
Smoke tests for AWS BackendManager.

Tests setup_remote_backend and cleanup_remote_backend using moto to mock AWS.
"""

import sys
from unittest.mock import MagicMock

sys.modules["ansible_runner"] = MagicMock()
sys.modules["python_vagrant"] = MagicMock()

import boto3
import pytest
from moto import mock_aws


class TestBackendManagerSmoke:
    """
    Smoke tests for BackendManager with AWS provider.

    Tests the full lifecycle: setup_remote_backend creates S3 bucket
    cleanup_remote_backend removes them.
    """

    @mock_aws
    def test_setup_remote_backend_creates_s3_bucket(self, aws_backend_context):
        """Setup remote backend should create S3 bucket when it doesn't exist."""
        provider = aws_backend_context["provider"]
        manager = aws_backend_context["manager"]

        backend_was_created = manager.setup_remote_backend()

        assert backend_was_created is True
        bucket_name = aws_backend_context["bucket_name"]
        s3_client = boto3.client("s3", region_name=aws_backend_context["region"])
        response = s3_client.head_bucket(Bucket=bucket_name)
        assert response["ResponseMetadata"]["HTTPStatusCode"] == 200


    @mock_aws
    def test_setup_remote_backend_writes_backend_tf(self, aws_backend_context):
        """Setup remote backend should write backend.tf configuration file."""
        manager = aws_backend_context["manager"]

        manager.setup_remote_backend()

        backend_tf_path = aws_backend_context["tmp_path"] / "backend.tf"
        assert backend_tf_path.exists()
        content = backend_tf_path.read_text()
        assert 'backend "s3"' in content
        assert "terraform-state-test-range-123" in content

    @mock_aws
    def test_setup_remote_backend_idempotent(self, aws_backend_context):
        """Setup remote backend should return False if resources already exist."""
        manager = aws_backend_context["manager"]

        first_call = manager.setup_remote_backend()
        second_call = manager.setup_remote_backend()

        assert first_call is True
        assert second_call is False

    @mock_aws
    def test_cleanup_remote_backend_deletes_s3_bucket(self, aws_backend_context):
        """Cleanup remote backend should delete S3 bucket."""
        provider = aws_backend_context["provider"]
        manager = aws_backend_context["manager"]

        manager.setup_remote_backend()
        manager.cleanup_remote_backend()

        bucket_name = aws_backend_context["bucket_name"]
        assert provider.check_s3_bucket(bucket_name, aws_backend_context["region"]) is False

    @mock_aws
    def test_full_lifecycle_setup_and_cleanup(self, aws_backend_context):
        """
        Full smoke test: setup creates resources, cleanup removes them.

        This simulates the build -> destroy flow.
        """
        provider = aws_backend_context["provider"]
        manager = aws_backend_context["manager"]
        bucket_name = aws_backend_context["bucket_name"]
        table_name = aws_backend_context["table_name"]
        region = aws_backend_context["region"]

        backend_created = manager.setup_remote_backend()
        assert backend_created is True
        assert provider.check_s3_bucket(bucket_name, region) is True

        manager.cleanup_remote_backend()
        assert provider.check_s3_bucket(bucket_name, region) is False
