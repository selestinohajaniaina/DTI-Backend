# DTI BACKEND — DON'T TRASH IT

The backend for **DTI (DON'T TRASH)** ()

> **Built from scratch starting October 26, 2026, during the Meta Global AI Developer Hackathon.**

---

**Frontend repository:** https://github.com/selestinohajaniaina/DTI


---

## META AI INTEGRATION

| Meta model | Responsibility |
|---|---|
| `muse-spark-1.3` — Muse Spark | Analyzes uploaded photographs and generates structured upcycling ideas. |
| `muse-image-1.0` — Muse Image | Generates illustrations for the proposed projects using the original photograph as a visual reference. |

### HOW THE AI WORKS

1. **Image upload:** The client sends an object's photograph to the backend.
2. **Visual analysis:** Muse Spark analyzes the image and identifies the object's characteristics.
3. **Idea generation:** Muse Spark generates structured reuse ideas, including descriptions, tutorials, materials, tools, difficulty, time estimates, safety notes, and price estimates.
4. **Image generation:** Muse Image creates an illustration for each generated idea.
5. **Validation:** The backend validates the structured AI response using Zod.
6. **Persistence:** The source object and generated ideas are saved in PostgreSQL.
7. **API response:** The backend returns the generated content and image URLs to the frontend.
---

## Technology Stack

| Category | Technology |
|---|---|
| Runtime | Node.js 22 |
| Language | TypeScript |
| HTTP framework | Express 5 |
| Database | PostgreSQL |
| ORM | Sequelize 6 |
| Migrations | Umzug |
| Validation | Zod |
| Authentication | JWT and bcrypt |
| AI integration | Meta Muse API |
| Testing | Vitest |
| Code quality | ESLint and Prettier |

---

## ARCHITECTURE

```text
src/
├── app.ts
├── server.ts
│
├── config/
│   ├── env.ts
│   ├── database.ts
│   └── umzug.ts
│
├── controllers/
├── services/
├── routes/
├── middlewares/
├── validators/
├── models/
├── migrations/
├── seeders/
├── scripts/
├── types/
└── utils/
    
tests/
```

### Main architectural responsibilities

- **Routes:** API Endpoints.
- **Controllers:** Handle HTTP requests and responses.
- **Services:** Implement application logic and operations.
- **Models:** Define PostgreSQL data structures using Sequelize.
- **Middlewares:** Authentication, validation, logging, and errors.
- **Validators:** Validate the coming requests and application data.
- **Migrations:** Manage database schema changes.
- **Configuration:** Environment variables and database connections.

---

## DATABASE

DTI uses PostgreSQL to persist generated content and user information.

---

## INSTALLATION LOCAL

### REQUIREMENTS

- Node.js 22 or compatible version specified in `.nvmrc`.
- npm 10 or later.
- PostgreSQL database.
- Meta API key for AI generation features.

### 1. Clone the repository

```bash
git clone https://github.com/selestinohajaniaina/DTI-Backend.git

cd DTI-Backend
```

### 2. Install dependencies

```bash
npm ci
```

### 3. Configure environment variables

```bash
cp .env.example .env
cp .env.test.example .env.test
```

Configure the required values in `.env`:

```env
NODE_ENV=development
PORT=3000

DATABASE_URL=postgres://USER:PASSWORD@localhost:5432/DATABASE_NAME

JWT_SECRET=your_secure_random_secret
JWT_EXPIRES_IN=15m

MODEL_API_KEY=your_meta_api_key
FRONTEND_URL=http://localhost:4200
```

The complete list of supported variables and defaults is documented in `.env.example`.

### 4. Run database migrations

```bash
npm run db:migrate
```

### 5. Start the server

```bash
npm run dev
```

The API will be available at:

```text
http://127.0.0.1:3000
```

Health check:

```text
http://127.0.0.1:3000/api/health
```

---

## Development Assistance

> **Note on AI-Assisted Development:** During the development of DTI, we used **Muse Code with `muse-spark-1.3-contributor · max` as our AI development agent**
