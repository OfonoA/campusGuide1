"""Detect login portal intent and build redirect notes."""
from typing import Dict, Optional

PORTAL_INTENTS = {
    "applications.must.ac.ug": {
        "url": "https://applications.must.ac.ug",
        "label": "MUST Online Application Portal",
        "keywords": [
            "apply online",
            "submit application",
            "online application",
            "application portal",
            "apply for admission",
            "apply now",
            "upload documents",
            "application form",
        ],
    },
    "student.must.ac.ug": {
        "url": "https://student.must.ac.ug",
        "label": "MUST Student Portal",
        "keywords": [
            "check results",
            "my results",
            "exam results",
            "student portal",
            "check grades",
            "transcripts",
            "registration status",
            "fee balance",
            "student account",
            "check my marks",
        ],
    },
    "timetable.must.ac.ug": {
        "url": "https://timetable.must.ac.ug",
        "label": "MUST Timetable Portal",
        "keywords": [
            "timetable",
            "class schedule",
            "lecture schedule",
            "exam timetable",
            "when is my class",
            "class time",
        ],
    },
    "vle.must.ac.ug": {
        "url": "https://vle.must.ac.ug",
        "label": "MUST Virtual Learning Environment",
        "keywords": [
            "e-learning",
            "elearning",
            "vle",
            "course materials",
            "submit assignment",
            "online learning",
            "moodle",
            "lecture notes",
            "course content",
            "download notes",
        ],
    },
}


def detect_portal_intent(query: str) -> Optional[Dict]:
    """Return portal dict if query indicates login portal intent."""
    lowered = query.lower()
    matches = []
    for portal, info in PORTAL_INTENTS.items():
        count = sum(1 for term in info["keywords"] if term in lowered)
        if count:
            matches.append((count, info))
    if not matches:
        return None
    matches.sort(key=lambda item: item[0], reverse=True)
    return matches[0][1]


def build_redirect_note(portal: Dict) -> str:
    """Return note to append to responses pointing users to the portal."""
    return f"\n\nTo access this directly, visit the {portal['label']}: {portal['url']}"
