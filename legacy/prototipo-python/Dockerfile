FROM python:3.13-slim
WORKDIR /app
COPY app.py engine.py ./
COPY sql/ ./sql/
RUN mkdir /data && chown 10001:10001 /data
USER 10001:10001
ENV DB_PATH=/data/mei.db PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["python","app.py"]
