from enum import StrEnum


class Role(StrEnum):
    OPERATOR = 'operator'
    SUPERVISOR = 'supervisor'
    VIEWER = 'viewer'


class Slot(StrEnum):
    DAY = 'day'
    NIGHT = 'night'


class Profile(StrEnum):
    COOL = 'cool'
    BALANCED = 'balanced'
    WARM = 'warm'


class RoundState(StrEnum):
    SCHEDULED = 'scheduled'
    NEEDS_REPLAN = 'needs_replan'
    COMPLETED = 'completed'
    CANCELLED = 'cancelled'


class RosterState(StrEnum):
    ACTIVE = 'active'
    TRIAL = 'trial'
    RETIRED = 'retired'


class RunKind(StrEnum):
    OFFICIAL = 'official'
    TRIAL = 'trial'


class ReplacementState(StrEnum):
    TRIAL = 'trial'
    SIGNED = 'signed'


MINUTES = {Profile.COOL: 20, Profile.BALANCED: 35, Profile.WARM: 50}
