from sqlmodel import create_engine
from typing import Optional
from sqlmodel import Field, SQLModel
from datetime import datetime

DATABASE_URL = "mysql+pymysql://root:@localhost:3306/juchat"
engine = create_engine(DATABASE_URL, echo=True)



class Post(SQLModel, table=True):
    __tablename__ = "posts"  # Optional, but good to be explicit

    post_id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int
    content: str
    image: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
