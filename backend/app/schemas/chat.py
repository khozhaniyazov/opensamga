from typing import Any

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: str = Field(..., description="'user' or 'assistant'")
    content: str


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    conversation_history: list[ChatMessage] = Field(default_factory=list)
    user_context: dict[str, Any] | None = Field(
        default=None, description="Optional student profile data (score, quota_type, etc.)"
    )


class ChatResponse(BaseModel):
    message: str
    tool_calls: list[dict[str, Any]] = Field(default_factory=list)
    requires_widget: bool = False

    class Config:
        json_schema_extra = {
            "example": {
                "message": "Based on your score of 115, you have a SAFE chance at KBTU Computer Science...",
                "tool_calls": [
                    {
                        "function_name": "calculate_grant_probability",
                        "result": {
                            "status": "SAFE",
                            "probability": 90,
                            "threshold": 110,
                            "buffer": 5,
                        },
                    }
                ],
                "requires_widget": True,
            }
        }
