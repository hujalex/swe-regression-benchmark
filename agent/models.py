from dataclasses import dataclass

from pydantic import BaseModel, Field


class RunResult(BaseModel):
    files_changed: list[str]
    tests_passed: bool
    commit_sha: str
    summary: str
    errors: list[str] = Field(default_factory=list)


@dataclass
class Deps:
    container_name: str = "dev-container"
    workspace: str = "/workspace"
