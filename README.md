# AI-Powered Customer Engagement & Booking System

An AI-powered customer engagement system consisting of a **WhatsApp Chatbot** and a **Management Dashboard** for customer communication, booking management, automated follow-ups, and conversation monitoring.

---

## Overview

This project was developed during my **Software Engineering Internship** to automate customer communication and improve the management of customer bookings and conversations.

The system consists of two main components:

* **Chatbot** — Handles customer conversations through WhatsApp using an AI model.
* **Dashboard** — Allows staff to monitor conversations, manage bookings, and manage customer follow-ups.

---

## Features

### AI Chatbot

* AI-powered customer conversations
* WhatsApp integration
* Automated customer responses
* Booking-related interactions
* Customer information handling
* Automated follow-up messages
* Multiple follow-up message templates
* Conversation/session synchronization
* Message logging

### Management Dashboard

* Customer conversation monitoring
* Real-time message updates
* Booking management
* Add, edit, and cancel bookings
* Customer information management
* Follow-up status tracking
* Automated follow-up management
* Message history
* Chatbot activity monitoring

### Booking Management

* Create bookings
* Edit bookings
* Cancel bookings
* View booking information
* Google Sheets synchronization

### Automated Follow-Up

The system automatically identifies customers who require follow-up and sends predefined messages based on their customer status.

```text
Customer Status
      │
      ▼
Check Follow-Up Requirement
      │
      ▼
Select Message Template
      │
      ▼
Send WhatsApp Message
      │
      ▼
Record Follow-Up
```

### Real-Time Updates

The dashboard uses **Server-Sent Events (SSE)** to receive and display new messages in real time without requiring manual page refreshes.

---

## System Architecture

```text
                         Customer
                            │
                            ▼
                        WhatsApp
                            │
                            ▼
                    ┌──────────────┐
                    │  AI Chatbot  │
                    └──────┬───────┘
                           │
                  ┌────────┴────────┐
                  ▼                 ▼
             Messages          Bookings
                  │                 │
                  └────────┬────────┘
                           ▼
                  ┌─────────────────┐
                  │    Dashboard    │
                  └────────┬────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
          Messages      Bookings    Follow-ups
                           │
                           ▼
                     Google Sheets
```

---

## Technologies

| Category        | Technologies             |
| --------------- | ------------------------ |
| Backend         | Laravel, PHP             |
| Frontend        | HTML, CSS, JavaScript    |
| Database        | SQLite                   |
| AI              | LLM API                  |
| Messaging       | WhatsApp                 |
| Real-Time       | Server-Sent Events (SSE) |
| Integration     | Google Sheets API        |
| Automation      | Cron Jobs                |
| Communication   | REST API, Webhooks       |
| Version Control | Git, GitHub              |

---

## Integrations

* **WhatsApp** — Customer communication
* **AI Model API** — AI-generated responses
* **Google Sheets** — Booking data synchronization
* **GitHub** — Version control and project management

---

## Project Structure

```text
project/
│
├── chatbot/
│   ├── agents/
│   ├── prompts/
│   ├── integrations/
│   ├── follow-up/
│   └── configuration/
│
├── dashboard/
│   ├── app/
│   ├── routes/
│   ├── resources/
│   ├── database/
│   └── public/
│
├── documentation/
│   ├── clone-guideline.md
│   └── migration-manual.md
│
└── README.md
```

---

## Security

Sensitive information should **never** be committed to the repository.

Examples include:

* API keys
* Access tokens
* WhatsApp session credentials
* Google Sheets credentials
* Environment variables

Use a `.env` file for sensitive configuration.

```env
AI_API_KEY=
WHATSAPP_API_KEY=
GOOGLE_SHEETS_CREDENTIALS=
```

Make sure `.env` is included in `.gitignore`.

---

## My Contributions

During my Software Engineering Internship, I contributed to:

* Developed the AI chatbot
* Developed the chatbot management dashboard
* Integrated WhatsApp communication
* Implemented real-time updates using SSE
* Implemented automated follow-up scheduling
* Developed booking management features
* Integrated Google Sheets synchronization
* Implemented webhook-based message logging
* Improved chatbot session synchronization
* Resolved duplicate message issues caused by WhatsApp gateway reconnections
* Created reusable follow-up message templates
* Standardized customer follow-up tags
* Created cloning and migration documentation
* Managed source code using GitHub

---

## Project Goals

The system aims to:

* Reduce repetitive manual customer service tasks
* Improve customer response time
* Automate customer follow-ups
* Centralize customer and booking information
* Simplify booking management
* Provide real-time conversation monitoring
* Improve overall customer engagement

---

## Documentation

Additional documentation is available in the `documentation/` directory.

* `clone-guideline.md` — Project cloning and setup guidelines
* `migration-manual.md` — Migration and deployment guidelines

---

## Developer

**Mandy Chen**

Software Engineering Intern

**Focus:** AI Chatbot · Dashboard Development · API Integration · Automation · Database · Real-Time Systems
