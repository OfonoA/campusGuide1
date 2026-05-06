from .database import engine
from .orm_models import Base
from sqlalchemy import text

def create_tables():
	Base.metadata.create_all(bind=engine)
	print("✅ Database tables created successfully")


def ensure_reference_code_column_size():
	"""Ensure tickets.reference_code can store new AR-<timestamp_ms>-<random_suffix> values."""
	try:
		with engine.begin() as conn:
			conn.execute(
				text(
					"ALTER TABLE tickets MODIFY reference_code VARCHAR(40) NOT NULL"
				)
			)
		print("✅ tickets.reference_code widened to VARCHAR(40)")
	except Exception as e:
		# Non-fatal: table/column may not exist yet or DB may not support this syntax.
		print(f"⚠️ Could not auto-migrate tickets.reference_code: {e}")

if __name__ == '__main__':
	create_tables()
	ensure_reference_code_column_size()
