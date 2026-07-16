import { environment } from "../../../environments/environment";
import { LeprosyPatientAttributesDto, LeprosyFirstVisitDto, TrackedEntityAttributeDto, toLeprosyPatientAttributesDto, toLeprosyFirstVisitDto, DataValueDto } from "../models/dhis2-tracked-entity.dto";


/** Combined view used by the patient detail screen. */
export interface PatientDetailDto {
  trackedEntity: string;
  orgUnit: string;
  attributes: LeprosyPatientAttributesDto;
  enrollment?: {
    enrollment: string;
    status: string;
    enrolledAt: string;
  };
  /** Present only if a "1st visit" (x0vRwubw5S7) event exists with data. */
  firstVisit?: LeprosyFirstVisitDto;
}

/**
 * Fetches a single tracked entity (patient) by id from the Tracker API,
 * including its "1st visit" stage event, and maps it into the strongly-typed
 * LeprosyPatientAttributesDto / LeprosyFirstVisitDto shapes.
 */
export class Dhis2PatientDetailService {
  constructor(
    private readonly baseUrl: string = environment.dhis2.baseUrl,
    private readonly authHeaders: Record<string, string> = {},
  ) {}

  async getPatientDetail(trackedEntityId: string): Promise<PatientDetailDto> {
    const params = new URLSearchParams({
      program: environment.dhis2.program,
      fields: [
        'trackedEntity',
        'orgUnit',
        'attributes[attribute,value]',
        'enrollments[enrollment,status,enrolledAt,events[event,programStage,status,dataValues[dataElement,value]]]',
      ].join(','),
    });

    const url = `${this.baseUrl}${environment.dhis2.endpoints.trackedEntities}/${trackedEntityId}?${params.toString()}`;

    const res = await fetch(url, { headers: this.authHeaders });
    if (!res.ok) {
      throw new Error(`Failed to fetch patient ${trackedEntityId}: ${res.status} ${res.statusText}`);
    }

    const tei = await res.json();
    return this.toPatientDetailDto(tei);
  }

  private toPatientDetailDto(tei: any): PatientDetailDto {
    const attributes: TrackedEntityAttributeDto[] = tei.attributes ?? [];
    const enrollment = (tei.enrollments ?? [])[0];

    const firstVisitEvent = (enrollment?.events ?? []).find(
      (e: any) => e.programStage === environment.PROGRAM_STAGES.FIRST_VISIT,
    );

    return {
      trackedEntity: tei.trackedEntity,
      orgUnit: tei.orgUnit,
      attributes: toLeprosyPatientAttributesDto(attributes),
      enrollment: enrollment
        ? {
            enrollment: enrollment.enrollment,
            status: enrollment.status,
            enrolledAt: enrollment.enrolledAt,
          }
        : undefined,
      firstVisit: firstVisitEvent
        ? toLeprosyFirstVisitDto(firstVisitEvent.dataValues as DataValueDto[])
        : undefined,
    };
  }
}