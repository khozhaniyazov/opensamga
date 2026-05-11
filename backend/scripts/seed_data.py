"""
scripts/seed_data.py
--------------------
Populates the database with realistic dummy data for the UNT SuperApp.
Context: Kazakhstan (Russian Language).
Features: Users, Profiles, Gamification, Squads, Social Graph.
"""

import asyncio
import os
import random
import sys
from datetime import UTC, datetime

from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# 1. Setup Path to import 'app' modules
# This allows the script to see the 'app' directory
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import engine
from app.models import (
    ActivityLog,
    ActivityType,
    Connection,
    ConnectionStatus,
    GamificationProfile,
    LeagueTier,
    MajorGroup,
    Squad,
    SquadMember,
    StudentProfile,
    UniversityData,
    UniversityDetail,
    User,
    Visibility,
)

# --- CONFIG ---
# Used to hash the dummy password "123456"
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def get_password_hash(password):
    return pwd_context.hash(password)


# --- DATASETS (Russian/KZ Context) ---

UNIVERSITIES = [
    {
        "code": "027",
        "name": "Казахский национальный университет им. аль-Фараби (KazNU)",
        "city": "Алматы",
        "keywords": "kaznu, казну, аль-фараби, альфараби, almaty, алматы",
    },
    {
        "code": "009",
        "name": "Евразийский национальный университет им. Л.Н. Гумилева (ENU)",
        "city": "Астана",
        "keywords": "enu, эну, гумилёв, гумилев, gumilyov, astana, астана",
    },
    {
        "code": "302",
        "name": "Astana IT University (AITU)",
        "city": "Астана",
        "keywords": "aitu, аиту, астана ит, it university, астана",
    },
    {
        "code": "023",
        "name": "Казахстанско-Британский технический университет (KBTU)",
        "city": "Алматы",
        "keywords": "kbtu, кбту, british, британский, almaty, алматы",
    },
    {
        "code": "300",
        "name": "Назарбаев Университет (NU)",
        "city": "Астана",
        "keywords": "nu, nazarbayev, нузу, astana, астана, нурсултан",
    },
    {
        "code": "020",
        "name": "Университет имени Сулеймана Демиреля (SDU)",
        "city": "Каскелен",
        "keywords": "sdu, сду, demirel, демирель, демирел, kaskelen, каскелен",
    },
    {
        "code": "022",
        "name": "Международный университет информационных технологий (IITU)",
        "city": "Алматы",
        "keywords": "iitu, муит, международный ит, almaty, алматы",
    },
    {
        "code": "025",
        "name": "Satbayev University (KAZNRTU)",
        "city": "Алматы",
        "keywords": "satbayev, сатпаев, сатпай, kaznrtu, казнрту, политех, almaty",
    },
    {
        "code": "005",
        "name": "Медицинский университет Астана (MUA)",
        "city": "Астана",
        "keywords": "mua, муа, медик, врач, medicine, астана, astana",
    },
    {
        "code": "033",
        "name": "Карагандинский технический университет (KTU)",
        "city": "Караганда",
        "keywords": "ktu, кту, караганда, karaganda, политех",
    },
]

MAJORS = [
    {
        "code": "B057",
        "name": "Информационные технологии",
        "subjects": ["Математика", "Информатика"],
        "keywords": "it, айти, ит, coding, программирование, developer, разработчик, программист, web, frontend, backend",
    },
    {
        "code": "B050",
        "name": "Биологические науки",
        "subjects": ["Биология", "Химия"],
        "keywords": "bio, biology, биолог, биология, медик, genetik, природа",
    },
    {
        "code": "B044",
        "name": "Менеджмент и управление",
        "subjects": ["Математика", "География"],
        "keywords": "management, менеджмент, бизнес, business, mba, управление, администратор",
    },
    {
        "code": "B060",
        "name": "Химическая инженерия",
        "subjects": ["Химия", "Физика"],
        "keywords": "chemical, химик, chemistry, нефть, oil, gas, газ, инженер",
    },
]

USERS_DATA = [
    {
        "name": "Алихан Смаилов",
        "email": "alikhan@test.com",
        "subjects": ["Математика", "Информатика"],
        "bio": "Хочу в AITU на грант! 🚀",
        "streak": 45,
        "xp": 12500,
        "league": LeagueTier.GOLD,
    },
    {
        "name": "Айгерим Нурланова",
        "email": "aigerim@test.com",
        "subjects": ["Биология", "Химия"],
        "bio": "Будущий врач. Медицина - это любовь ❤️",
        "streak": 12,
        "xp": 3400,
        "league": LeagueTier.SILVER,
    },
    {
        "name": "Борис Ким",
        "email": "boris@test.com",
        "subjects": ["Математика", "Физика"],
        "bio": "KBTU или ничего. Физика сложная...",
        "streak": 5,
        "xp": 800,
        "league": LeagueTier.BRONZE,
    },
    {
        "name": "Диана Ержанова",
        "email": "diana@test.com",
        "subjects": ["Математика", "География"],
        "bio": "Экономика и финансы. Ищу стади бадди!",
        "streak": 89,
        "xp": 25000,
        "league": LeagueTier.DIAMOND,
    },
    {
        "name": "Ержан Болатов",
        "email": "erzhan@test.com",
        "subjects": ["Математика", "Информатика"],
        "bio": "Прогаю на Python. Готовлюсь к IELTS.",
        "streak": 0,
        "xp": 150,
        "league": LeagueTier.BRONZE,
    },
    {
        "name": "София Ли",
        "email": "sofia@test.com",
        "subjects": ["Математика", "Информатика"],
        "bio": "Цель: Грант в SDU.",
        "streak": 20,
        "xp": 6000,
        "league": LeagueTier.GOLD,
    },
    {
        "name": "Тимур Беков",
        "email": "timur@test.com",
        "subjects": ["Математика", "Физика"],
        "bio": "Инженер-нефтяник in progress.",
        "streak": 3,
        "xp": 1200,
        "league": LeagueTier.SILVER,
    },
    {
        "name": "Мадина Омарова",
        "email": "madina@test.com",
        "subjects": ["Биология", "Химия"],
        "bio": "Химия сложная, помогите(",
        "streak": 30,
        "xp": 9000,
        "league": LeagueTier.GOLD,
    },
    {
        "name": "Руслан Алиев",
        "email": "ruslan@test.com",
        "subjects": ["Всемирная История", "Английский"],
        "bio": "Международные отношения.",
        "streak": 60,
        "xp": 18000,
        "league": LeagueTier.DIAMOND,
    },
    {
        "name": "Камила Сатова",
        "email": "kamila@test.com",
        "subjects": ["Математика", "Информатика"],
        "bio": "Frontend разработчик. Ищу команду.",
        "streak": 10,
        "xp": 2000,
        "league": LeagueTier.SILVER,
    },
]

SQUADS = ["Охотники за Грантами", "Python Wizards", "Медики 2025", "Физики-Ядерщики"]

# --- SEEDING LOGIC ---


async def seed_universities(db: AsyncSession):
    print("🎓 Seeding Universities...")
    for u in UNIVERSITIES:
        # Check if exists
        stmt = select(UniversityDetail).where(UniversityDetail.university_code == u["code"])
        exists = await db.execute(stmt)
        if exists.scalar():
            continue

        # 1. Detail (Canonical) with search_keywords for human-friendly search
        detail = UniversityDetail(
            full_name=u["name"],
            university_code=u["code"],
            website="https://test.edu.kz",
            has_dorm="True",
            military_chair="True" if random.random() > 0.5 else "False",
            search_keywords=u.get("keywords", ""),  # Add search keywords
        )
        db.add(detail)

        # 2. Data (Aggregate for Search/Grants)
        # Add dummy rows for each major for this uni
        for m in MAJORS:
            data = UniversityData(
                uni_name=u["name"],
                major_code=m["code"],
                major_name=m["name"],
                min_score_paid=60,
                grant_threshold_general=random.randint(70, 130),
                grant_threshold_rural=random.randint(60, 120),
            )
            db.add(data)

    # 3. Majors with search_keywords for human-friendly search
    for m in MAJORS:
        stmt = select(MajorGroup).where(MajorGroup.group_code == m["code"])
        exists = await db.execute(stmt)
        if not exists.scalar():
            major = MajorGroup(
                group_code=m["code"],
                group_name=m["name"],
                unt_subjects=", ".join(m["subjects"]),
                search_keywords=m.get("keywords", ""),  # Add search keywords
            )
            db.add(major)

    await db.commit()


async def seed_users(db: AsyncSession):
    print("👥 Seeding Users...")
    created_users = []

    # Fetch university IDs to assign target universities
    uni_res = await db.execute(select(UniversityDetail))
    unis = uni_res.scalars().all()
    uni_ids = [u.id for u in unis]

    for u_data in USERS_DATA:
        # Check if user exists
        stmt = select(User).where(User.email == u_data["email"])
        result = await db.execute(stmt)
        existing = result.scalars().first()

        if existing:
            created_users.append(existing)
            continue

        # 1. Create User
        user = User(
            email=u_data["email"],
            hashed_password=get_password_hash("123456"),
            name=u_data["name"],
            full_name=u_data["name"],
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        created_users.append(user)

        # 2. Student Profile
        target_uni = random.choice(uni_ids) if uni_ids else None
        profile = StudentProfile(
            user_id=user.id,
            bio=u_data["bio"],
            target_university_id=target_uni,
            chosen_subjects=u_data["subjects"],
            avatar_url=f"https://api.dicebear.com/7.x/avataaars/svg?seed={user.email}",
        )
        db.add(profile)

        # 3. Gamification Profile
        gamif = GamificationProfile(
            user_id=user.id,
            current_streak=u_data["streak"],
            total_xp=u_data["xp"],
            league_tier=u_data["league"],
            last_activity_date=datetime.now(UTC),
        )
        db.add(gamif)

        # 4. Activity Log (Initial Streak)
        log = ActivityLog(
            user_id=user.id,
            activity_type=ActivityType.STREAK_MILESTONE,
            metadata_blob={"streak": u_data["streak"]},
            visibility=Visibility.PUBLIC,
        )
        db.add(log)

    await db.commit()
    return created_users


async def seed_social(db: AsyncSession, users):
    print("🕸️ Seeding Social Graph & Squads...")

    if len(users) < 2:
        return

    # 1. Create Squads
    for i, squad_name in enumerate(SQUADS):
        if i >= len(users):
            break
        leader = users[i]

        # Check if squad exists
        stmt = select(Squad).where(Squad.name == squad_name)
        exists = await db.execute(stmt)
        if exists.scalar():
            continue

        squad = Squad(name=squad_name, created_by=leader.id)
        db.add(squad)
        await db.commit()
        await db.refresh(squad)

        # Add leader as member
        sm = SquadMember(
            squad_id=squad.id,
            user_id=leader.id,
            is_leader=True,
            xp_contributed=random.randint(100, 5000),
        )
        db.add(sm)

        # Add random recruits
        potential_members = [u for u in users if u.id != leader.id]
        if potential_members:
            recruits = random.sample(
                potential_members, k=min(len(potential_members), random.randint(1, 2))
            )
            for recruit in recruits:
                # Check duplication
                mem_stmt = select(SquadMember).where(SquadMember.user_id == recruit.id)
                mem_exists = await db.execute(mem_stmt)
                if not mem_exists.scalar():
                    sm_rec = SquadMember(
                        squad_id=squad.id,
                        user_id=recruit.id,
                        xp_contributed=random.randint(50, 2000),
                    )
                    db.add(sm_rec)

    # 2. Create Connections (Chain of friends)
    for i in range(len(users) - 1):
        u1 = users[i]
        u2 = users[i + 1]

        # Check existing connection
        conn_stmt = select(Connection).where(
            Connection.follower_id == u1.id, Connection.following_id == u2.id
        )
        conn_exists = await db.execute(conn_stmt)
        if not conn_exists.scalar():
            c1 = Connection(follower_id=u1.id, following_id=u2.id, status=ConnectionStatus.ACTIVE)
            c2 = Connection(follower_id=u2.id, following_id=u1.id, status=ConnectionStatus.ACTIVE)
            db.add_all([c1, c2])

            # Log the connection event
            log = ActivityLog(
                user_id=u1.id,
                activity_type=ActivityType.BADGE_EARNED,  # Placeholder activity type
                metadata_blob={"action": "CONNECTED", "with": u2.name},
                visibility=Visibility.PUBLIC,
            )
            db.add(log)

    await db.commit()


async def main():
    # Helper to get session since we are outside FastAPI request cycle
    from sqlalchemy.orm import sessionmaker

    AsyncSessionLocal = sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

    async with AsyncSessionLocal() as db:
        await seed_universities(db)

        # Create users and get the list back
        users = await seed_users(db)

        # Verify user list is populated (in case they already existed)
        if not users or len(users) < len(USERS_DATA):
            result = await db.execute(select(User))
            users = result.scalars().all()

        await seed_social(db, users)

    print("\n✅ Database Seeded Successfully! You can now log in.")
    print("👉 See USERS_DATA at the top of this file for seeded credentials.")
    print("⚠️  The seeded passwords are weak demo passwords — rotate before any real deployment.")


if __name__ == "__main__":
    # Windows fix for asyncio loop
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
