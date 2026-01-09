from backend.database.database import engine
from backend.database.orm_models import Base

def create_tables():
	Base.metadata.create_all(bind=engine)
	print("✅ Database tables created successfully")

if __name__ == '__main__':
	create_tables()
