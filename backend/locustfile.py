from locust import HttpUser, between, task


class LibrarySearchUser(HttpUser):
    wait_time = between(0.1, 0.5)

    @task
    def search_ru(self):
        self.client.post(
            "/api/library/search",
            json={"query": "как уравнять окислительно-восстановительную реакцию"},
            headers={"Content-Type": "application/json"},
        )

    @task
    def search_kz(self):
        self.client.post(
            "/api/library/search",
            json={"query": "Қазақстан тәуелсіздік күні қашан?"},
            headers={"Content-Type": "application/json"},
        )

    @task
    def search_kz2(self):
        self.client.post(
            "/api/library/search",
            json={"query": "теңдеуді шешудің әдістері 9 сынып"},
            headers={"Content-Type": "application/json"},
        )
