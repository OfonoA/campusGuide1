from database import engine
from orm_models import Base

Base.metadata.create_all(bind=engine)
print("✅ Database tables created successfully")
