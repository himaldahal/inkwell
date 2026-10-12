from django.core.exceptions import ValidationError


class MixedCaseDigitValidator:
    """Requires upper case, lower case and a number (matches the live hints in the UI)."""

    def validate(self, password, user=None):
        if not (any(c.islower() for c in password) and any(c.isupper() for c in password) and any(c.isdigit() for c in password)):
            raise ValidationError("Mix upper case, lower case and a number.", code="password_mixed")

    def get_help_text(self):
        return "Use upper case, lower case and a number."
